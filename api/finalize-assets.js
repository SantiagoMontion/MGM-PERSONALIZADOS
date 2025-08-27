// api/finalize-assets.js
import { cors } from './_lib/cors.js';
import getSupabaseAdmin from './_lib/supabaseAdmin.js';
import sharp from 'sharp';
import crypto from 'node:crypto';

function parseUploadsObjectKey(url = '') {
  const idx = url.indexOf('/uploads/');
  return idx >= 0 ? url.slice(idx + '/uploads/'.length) : '';
}

function buildOutputPaths({ job_id }) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const base = `outputs/${yyyy}/${mm}/${job_id}`;
  return {
    preview: `${base}-preview.jpg`,
    print: `${base}-print.jpg`,
    mock1080: `${base}-mock_1080.png`,
  };
}

function err(res, status, { diag_id, stage, message, hints = [], debug = {} }) {
  return res.status(status).json({ ok: false, diag_id, stage, message, hints, debug });
}

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return err(res, 405, {
      diag_id: diagId,
      stage: 'method',
      message: 'method_not_allowed',
    });
  }

  let stage = 'validate';
  let debug = {};

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { job_id, render_v2 } = body;
    if (!job_id) {
      return err(res, 400, {
        diag_id: diagId,
        stage: 'validate',
        message: 'missing_job_id',
      });
    }
    if (!render_v2 || !render_v2.canvas_px || !render_v2.place_px) {
      return err(res, 400, {
        diag_id: diagId,
        stage: 'validate',
        message: 'bad_render_v2',
      });
    }

    const supa = getSupabaseAdmin();

    stage = 'load_job';
    const { data: job, error: jobErr } = await supa
      .from('jobs')
      .select(
        'id, job_id, file_original_url, preview_url, print_jpg_url, mock_1080_url, status'
      )
      .eq('job_id', job_id)
      .maybeSingle();
    if (jobErr) throw new Error('db_load_error: ' + jobErr.message);
    if (!job) {
      return err(res, 404, {
        diag_id: diagId,
        stage: 'load_job',
        message: 'job_not_found',
      });
    }
    if (!job.file_original_url) {
      return err(res, 400, {
        diag_id: diagId,
        stage: 'validate',
        message: 'missing_original_url',
      });
    }

    if (job.print_jpg_url && job.status === 'READY_FOR_PRINT') {
      return res.status(200).json({
        ok: true,
        already: true,
        job_id,
        preview_url: job.preview_url,
        print_jpg_url: job.print_jpg_url,
        ...(job.mock_1080_url ? { mock_1080_url: job.mock_1080_url } : {}),
      });
    }

    stage = 'download_src';
    const objectKey = parseUploadsObjectKey(job.file_original_url);
    if (!objectKey) {
      return err(res, 400, {
        diag_id: diagId,
        stage: 'download_src',
        message: 'bad_original_url',
      });
    }
    const { data: srcDownload, error: srcErr } = await supa.storage
      .from('uploads')
      .download(objectKey);
    if (srcErr || !srcDownload) {
      return err(res, 502, {
        diag_id: diagId,
        stage: 'download_src',
        message: 'download_failed',
        hints: srcErr ? [srcErr.message] : [],
      });
    }
    const srcBuf = Buffer.from(await srcDownload.arrayBuffer());

    stage = 'compose';

    const DPI = 300;
    const bleed_cm = (render_v2.bleed_mm ?? 3) / 10;
    const inner_w_px = Math.round((render_v2.w_cm * DPI) / 2.54);
    const inner_h_px = Math.round((render_v2.h_cm * DPI) / 2.54);
    const bleed_px = Math.round((bleed_cm * DPI) / 2.54);
    const out_w_px = inner_w_px + 2 * bleed_px;
    const out_h_px = inner_h_px + 2 * bleed_px;
    const cw = render_v2.canvas_px?.w | 0;
    const ch = render_v2.canvas_px?.h | 0;
    if (!cw || !ch) {
      return err(res, 400, {
        diag_id: diagId,
        stage: 'validate',
        message: 'bad_canvas',
      });
    }
    const place = render_v2.place_px;
    if (!place || place.w <= 0 || place.h <= 0) {
      return err(res, 400, {
        diag_id: diagId,
        stage: 'validate',
        message: 'bad_place',
      });
    }
    const scaleX = inner_w_px / cw;
    const scaleY = inner_h_px / ch;
    const scale = Math.min(scaleX, scaleY);
    const targetW = Math.max(1, Math.round(place.w * scale));
    const targetH = Math.max(1, Math.round(place.h * scale));
    let destX = bleed_px + Math.round(place.x * scale);
    let destY = bleed_px + Math.round(place.y * scale);

    const srcRot = await sharp(srcBuf)
      .rotate(render_v2.rotate_deg ?? 0)
      .toBuffer();
    const resized = await sharp(srcRot)
      .resize({ width: targetW, height: targetH, fit: 'fill' })
      .toBuffer();

    const cutLeft = Math.max(0, -destX);
    const cutTop = Math.max(0, -destY);
    const cutRight = Math.max(0, destX + targetW - out_w_px);
    const cutBottom = Math.max(0, destY + targetH - out_h_px);

    const clipX = cutLeft;
    const clipY = cutTop;
    const clipW = Math.max(1, targetW - cutLeft - cutRight);
    const clipH = Math.max(1, targetH - cutTop - cutBottom);

    const layer = await sharp(resized)
      .extract({ left: clipX, top: clipY, width: clipW, height: clipH })
      .toBuffer();

    destX = Math.max(0, destX);
    destY = Math.max(0, destY);

    debug = {
      inner_w_px,
      inner_h_px,
      out_w_px,
      out_h_px,
      scaleX,
      scaleY,
      scale,
      place,
      destX,
      destY,
      targetW,
      targetH,
      clipX,
      clipY,
      clipW,
      clipH,
    };

    const bgHex =
      render_v2.fit_mode === 'contain' && render_v2.bg_hex
        ? render_v2.bg_hex
        : '#000000';
    const base = await sharp({
      create: { width: out_w_px, height: out_h_px, channels: 3, background: bgHex },
    })
      .png()
      .toBuffer();
    const printBuf = await sharp(base)
      .composite([{ input: layer, left: destX, top: destY }])
      .jpeg({ quality: 92 })
      .toBuffer();

    const previewBuf = await sharp(printBuf)
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    let mock1080Buf = null;
    try {
      const base1080 = await sharp({
        create: {
          width: 1080,
          height: 1080,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer();
      const ratio = render_v2.w_cm / render_v2.h_cm;
      const usable = Math.round(1080 * 0.8);
      let padW, padH;
      if (ratio >= 1) {
        padW = usable;
        padH = Math.round(usable / ratio);
      } else {
        padH = usable;
        padW = Math.round(usable * ratio);
      }
      const padX = Math.round((1080 - padW) / 2);
      const padY = Math.round((1080 - padH) / 2);
      const imgCover = await sharp(printBuf)
        .resize({ width: padW, height: padH, fit: 'cover', position: 'centre' })
        .toBuffer();
      const radius = Math.max(24, Math.round(Math.min(padW, padH) * 0.05));
      const maskSvg = `<svg width="${padW}" height="${padH}" viewBox="0 0 ${padW} ${padH}"><rect x="0" y="0" width="${padW}" height="${padH}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`;
      const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer();
      const rounded = await sharp(imgCover)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
      mock1080Buf = await sharp(base1080)
        .composite([{ input: rounded, left: padX, top: padY }])
        .png()
        .toBuffer();
    } catch (e) {
      console.warn('mockup_1080_failed', e?.message);
    }

    stage = 'upload';
    const out = buildOutputPaths({ job_id });
    const upPrev = await supa.storage
      .from('outputs')
      .upload(out.preview.replace(/^outputs\//, ''), previewBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (upPrev.error)
      throw new Error('upload_preview_failed: ' + upPrev.error.message);
    const upPrint = await supa.storage
      .from('outputs')
      .upload(out.print.replace(/^outputs\//, ''), printBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (upPrint.error)
      throw new Error('upload_print_failed: ' + upPrint.error.message);
    if (mock1080Buf) {
      const upMock = await supa.storage
        .from('outputs')
        .upload(out.mock1080.replace(/^outputs\//, ''), mock1080Buf, {
          contentType: 'image/png',
          upsert: true,
        });
      if (upMock.error)
        throw new Error('upload_mock_failed: ' + upMock.error.message);
    }

    stage = 'db';
    const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const preview_url = `${baseUrl}/storage/v1/object/public/${out.preview}`;
    const print_jpg_url = `${baseUrl}/storage/v1/object/public/${out.print}`;
    const mock_1080_url = mock1080Buf
      ? `${baseUrl}/storage/v1/object/public/${out.mock1080}`
      : null;
    const updateObj = {
      preview_url,
      print_jpg_url,
      status: 'READY_FOR_PRINT',
    };
    if (mock_1080_url) updateObj.mock_1080_url = mock_1080_url;
    const { error: upErr } = await supa
      .from('jobs')
      .update(updateObj)
      .eq('id', job.id);
    if (upErr) throw new Error('db_update_failed: ' + upErr.message);

    return res.status(200).json({
      ok: true,
      job_id,
      preview_url,
      print_jpg_url,
      ...(mock_1080_url ? { mock_1080_url } : {}),
    });
  } catch (e) {
    console.error('finalize-assets error', { diagId, stage, error: e });
    const status = stage === 'download_src' ? 502 : 500;
    const msgMap = {
      download_src: 'download_failed',
      compose: 'compose_failed',
      upload: 'upload_failed',
      db: 'db_failed',
    };
    return err(res, status, {
      diag_id: diagId,
      stage,
      message: msgMap[stage] || 'internal_error',
      debug,
    });
  }
}

