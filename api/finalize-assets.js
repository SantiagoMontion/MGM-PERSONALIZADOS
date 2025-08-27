// api/finalize-assets.js
import { cors } from './_lib/cors.js';
import getSupabaseAdmin from './_lib/supabaseAdmin.js';
import sharp from 'sharp';
import composeImage from './_lib/composeImage.ts';
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

function isPosFinite(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
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

  let body;
  try {
    body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch (e) {
    return err(res, 400, {
      diag_id: diagId,
      stage,
      message: 'bad_json',
      debug: { body: req.body },
    });
  }

  const { job_id, render_v2 } = body;
  if (!job_id || !render_v2 || !render_v2.canvas_px || !render_v2.place_px) {
    debug = {
      has_job_id: !!job_id,
      has_render_v2: !!render_v2,
      has_canvas: !!render_v2?.canvas_px,
      has_place: !!render_v2?.place_px,
    };
    return err(res, 400, {
      diag_id: diagId,
      stage,
      message: 'missing_fields',
      debug,
    });
  }

  const c = render_v2.canvas_px;
  const p = render_v2.place_px;
  const invalidField =
    !isPosFinite(c.w)
      ? ['canvas_px.w', c.w]
      : !isPosFinite(c.h)
      ? ['canvas_px.h', c.h]
      : !Number.isFinite(p.x)
      ? ['place_px.x', p.x]
      : !Number.isFinite(p.y)
      ? ['place_px.y', p.y]
      : !isPosFinite(p.w)
      ? ['place_px.w', p.w]
      : !isPosFinite(p.h)
      ? ['place_px.h', p.h]
      : !isPosFinite(render_v2.w_cm)
      ? ['w_cm', render_v2.w_cm]
      : !isPosFinite(render_v2.h_cm)
      ? ['h_cm', render_v2.h_cm]
      : null;
  if (invalidField) {
    const [field, value] = invalidField;
    return err(res, 400, {
      diag_id: diagId,
      stage,
      message: 'invalid_number',
      debug: { field, value },
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
  if (jobErr) {
    return err(res, 500, {
      diag_id: diagId,
      stage: 'db',
      message: 'db_failed',
      debug: { error: jobErr.message },
    });
  }
  if (!job) {
    return err(res, 404, {
      diag_id: diagId,
      stage: 'load_job',
      message: 'job_not_found',
      debug: { job_id },
    });
  }
  if (!job.file_original_url) {
    return err(res, 400, {
      diag_id: diagId,
      stage,
      message: 'missing_original_url',
      debug: { job_id },
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
      stage,
      message: 'bad_original_url',
      debug: { file_original_url: job.file_original_url },
    });
  }
  const { data: srcDownload, error: srcErr } = await supa.storage
    .from('uploads')
    .download(objectKey);
  if (srcErr || !srcDownload) {
    return err(res, 502, {
      diag_id: diagId,
      stage,
      message: 'download_failed',
      debug: { objectKey, error: srcErr?.message },
    });
  }
  const srcBuf = Buffer.from(await srcDownload.arrayBuffer());

  stage = 'compose';
  let printBuf;
  try {
    const comp = await composeImage({ render_v2, srcBuf });
    ({ printBuf, debug } = comp);
  } catch (e) {
    if (e?.message === 'invalid_bbox') {
      debug = e.debug || {};
      return err(res, 400, { diag_id: diagId, stage, message: 'invalid_bbox', debug });
    }
    throw e;
  }

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

