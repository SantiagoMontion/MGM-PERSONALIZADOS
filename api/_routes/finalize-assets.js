// api/finalize-assets.js
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import composeImage from '../_lib/composeImage.ts';
import crypto from 'node:crypto';

function parseUploadsObjectKey(url = '') {
  const idx = url.indexOf('/uploads/');
  return idx >= 0 ? url.slice(idx + '/uploads/'.length) : '';
}

function extractSlug(objectKey = '') {
  const base = objectKey.split('/').pop() || '';
  const m = base.match(/^(.*?)-\d+x\d+-[^-]+-[a-f0-9]{8}\.\w+$/i);
  return m ? m[1] : 'design';
}

function buildOutputPaths({ job_id, slug, w_cm, h_cm, material }) {
  const size = `${Math.round(w_cm)}x${Math.round(h_cm)}`;
  const printBase = `outputs/print/${job_id}`;
  const mockBase = `outputs/mock/${job_id}`;
  return {
    printJpg: `${printBase}/${slug}-${size}-${material}.jpg`,
    pdf: `${printBase}/${slug}-${size}-${material}.pdf`,
    mock1080: `${mockBase}/${slug}-1080.png`,
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
  if (
    !job_id ||
    !render_v2 ||
    !render_v2.canvas_px ||
    !render_v2.place_px ||
    !render_v2.pad_px
  ) {
    debug = {
      has_job_id: !!job_id,
      has_render_v2: !!render_v2,
      has_canvas: !!render_v2?.canvas_px,
      has_place: !!render_v2?.place_px,
      has_pad: !!render_v2?.pad_px,
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
  const pad = render_v2.pad_px;
  const invalidField =
    !isPosFinite(c.w)
      ? ['canvas_px.w', c.w]
      : !isPosFinite(c.h)
      ? ['canvas_px.h', c.h]
      : !Number.isFinite(pad.x)
      ? ['pad_px.x', pad.x]
      : !Number.isFinite(pad.y)
      ? ['pad_px.y', pad.y]
      : !isPosFinite(pad.w)
      ? ['pad_px.w', pad.w]
      : !isPosFinite(pad.h)
      ? ['pad_px.h', pad.h]
      : !isPosFinite(pad.radius_px)
      ? ['pad_px.radius_px', pad.radius_px]
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

  console.log(
    JSON.stringify({
      diag_id: diagId,
      stage: 'validate',
      debug: {
        canvas: c,
        pad,
        place: p,
        place_rel: { x: p.x - pad.x, y: p.y - pad.y },
        w_cm: render_v2.w_cm,
        h_cm: render_v2.h_cm,
        bleed_mm: render_v2.bleed_mm,
      },
    })
  );

  const supa = getSupabaseAdmin();

  stage = 'load_job';
    const { data: job, error: jobErr } = await supa
      .from('jobs')
      .select(
        'id, job_id, file_original_url, preview_url, print_jpg_url, status, w_cm, h_cm, material'
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
      });
    }

  stage = 'download_src';
  const objectKey = parseUploadsObjectKey(job.file_original_url);
  const slug = extractSlug(objectKey);
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

  console.log(
    JSON.stringify({ diag_id: diagId, stage: 'download_src', debug: { objectKey } })
  );

  stage = 'compose';
  let innerBuf;
  try {
    const comp = await composeImage({ render_v2, srcBuf });
    ({ innerBuf, debug } = comp);
    console.log(JSON.stringify({ diag_id: diagId, stage: 'compose', debug }));
  } catch (e) {
    if (e?.message === 'invalid_bbox') {
      debug = e.debug || {};
      return err(res, 400, { diag_id: diagId, stage, message: 'invalid_bbox', debug });
    }
    throw e;
  }

  stage = 'print_export';
  const w_cm = render_v2.w_cm;
  const h_cm = render_v2.h_cm;
  const out_w_cm = w_cm + 2;
  const out_h_cm = h_cm + 2;
  const DPI = 300;
  const inner_w_px = Math.round((w_cm * DPI) / 2.54);
  const inner_h_px = Math.round((h_cm * DPI) / 2.54);
  const out_w_px = Math.round((out_w_cm * DPI) / 2.54);
  const out_h_px = Math.round((out_h_cm * DPI) / 2.54);
  const pixelRatioX = inner_w_px / pad.w;
  const pixelRatioY = inner_h_px / pad.h;
  const pixelRatio = Math.min(pixelRatioX, pixelRatioY);
  const scaleX = out_w_px / inner_w_px;
  const scaleY = out_h_px / inner_h_px;
  const page_w_pt = (out_w_cm / 2.54) * 72;
  const page_h_pt = (out_h_cm / 2.54) * 72;
  console.log('[EXPORT LIENZO DEBUG]', {
    w_cm,
    h_cm,
    out_w_cm,
    out_h_cm,
    inner_w_px,
    inner_h_px,
    out_w_px,
    out_h_px,
    scaleX,
    scaleY,
    pdf_engine: 'pdf-lib',
    page_w_unit: 'pt',
    page_w: page_w_pt,
    page_h: page_h_pt,
  });

  const stretchedPng = await sharp(innerBuf)
    .resize({ width: out_w_px, height: out_h_px, fit: 'fill' })
    .png()
    .toBuffer();
  const printJpgBuf = await sharp(stretchedPng)
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([page_w_pt, page_h_pt]);
  const pdfImg = await pdfDoc.embedJpg(printJpgBuf);
  page.drawImage(pdfImg, { x: 0, y: 0, width: page_w_pt, height: page_h_pt });
  const pdfBuf = await pdfDoc.save();

  let mock1080Buf = null;
  try {
    const REF_MAX = {
      Classic: { w: 140, h: 100 },
      PRO: { w: 140, h: 100 },
      Glasspad: { w: 50, h: 40 },
    };
    const MIN_MARGIN = 100;
    const MAX_MARGIN = 220;
    const ref = REF_MAX[job.material] || { w: w_cm, h: h_cm };
    const REF_AREA = ref.w * ref.h;
    const AREA = w_cm * h_cm;
    const areaRatio = Math.min(Math.max(AREA / REF_AREA, 0), 1);
    const gamma = 0.6;
    const rel = Math.pow(areaRatio, gamma);
    const marginPx = Math.round(
      MAX_MARGIN - (MAX_MARGIN - MIN_MARGIN) * rel
    );
    const avail = 1080 - 2 * marginPx;
    const k = Math.min(avail / w_cm, avail / h_cm);
    const target_w = Math.round(w_cm * k);
    const target_h = Math.round(h_cm * k);
    const drawX = Math.round((1080 - target_w) / 2);
    const drawY = Math.round((1080 - target_h) / 2);
    console.log('[MOCKUP SCALE DEBUG]', {
      w_cm,
      h_cm,
      REF_W_CM: ref.w,
      REF_H_CM: ref.h,
      REF_AREA,
      AREA,
      areaRatio,
      gamma,
      rel,
      MIN_MARGIN,
      MAX_MARGIN,
      marginPx,
      avail,
      k,
      target_w,
      target_h,
      drawX,
      drawY,
    });
    const resized = await sharp(stretchedPng)
      .resize({ width: target_w, height: target_h })
      .toBuffer();
    const radius = Math.max(12, Math.min(Math.min(target_w, target_h) * 0.02, 20));
    const maskSvg = `<svg width="${target_w}" height="${target_h}" viewBox="0 0 ${target_w} ${target_h}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${target_w}" height="${target_h}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`;
    const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer();
    const rounded = await sharp(resized)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    const inset = 4;
    const seamW = target_w - inset * 2;
    const seamH = target_h - inset * 2;
    const seamR = Math.max(0, radius - inset);
    const inset2 = 2;
    const innerW2 = target_w - inset2 * 2;
    const innerH2 = target_h - inset2 * 2;
    const innerR2 = Math.max(0, radius - inset2);
    const borderSvg = `<svg width="${target_w}" height="${target_h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${target_w}" height="${target_h}" rx="${radius}" ry="${radius}" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="2"/>
      <rect x="${inset}" y="${inset}" width="${seamW}" height="${seamH}" rx="${seamR}" ry="${seamR}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.5" stroke-dasharray="3 3"/>
      <rect x="${inset2}" y="${inset2}" width="${innerW2}" height="${innerH2}" rx="${innerR2}" ry="${innerR2}" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>
    </svg>`;
    const withBorder = await sharp(rounded)
      .composite([{ input: Buffer.from(borderSvg) }])
      .png()
      .toBuffer();
    mock1080Buf = await sharp({
      create: {
        width: 1080,
        height: 1080,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: withBorder, left: drawX, top: drawY }])
      .png()
      .toBuffer();
    console.log('[MOCKUP 1080 FINAL]', {
      material: job.material,
      w_cm,
      h_cm,
      REF_MAX_W_CM: ref.w,
      REF_MAX_H_CM: ref.h,
      rel,
      margin: marginPx,
      avail,
      k,
      target_w,
      target_h,
      drawX,
      drawY,
      r: radius,
      seam: { lineDash: [3, 3], lw1: 2, lw2: 1.5, lw3: 1 },
    });
  } catch (e) {
    console.warn('mockup_1080_failed', e?.message);
  }

  stage = 'upload';
  const out = buildOutputPaths({
    job_id,
    slug,
    w_cm: out_w_cm,
    h_cm: out_h_cm,
    material: job.material,
  });
  const upPrint = await supa.storage
    .from('outputs')
    .upload(out.printJpg.replace(/^outputs\//, ''), printJpgBuf, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  if (upPrint.error)
    throw new Error('upload_print_failed: ' + upPrint.error.message);
  const upPdf = await supa.storage
    .from('outputs')
    .upload(out.pdf.replace(/^outputs\//, ''), Buffer.from(pdfBuf), {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upPdf.error)
    throw new Error('upload_pdf_failed: ' + upPdf.error.message);
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

  console.log(
    JSON.stringify({ diag_id: diagId, stage: 'upload', debug: { out } })
  );

  stage = 'db';
  const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const preview_url = mock1080Buf
    ? `${baseUrl}/storage/v1/object/public/${out.mock1080}`
    : null;
  const print_jpg_url = `${baseUrl}/storage/v1/object/public/${out.printJpg}`;
  const pdf_url = `${baseUrl}/storage/v1/object/public/${out.pdf}`;
  const updateObj = {
    preview_url,
    print_jpg_url,
    pdf_url,
    status: 'READY_FOR_PRINT',
  };
  const { error: upErr } = await supa
    .from('jobs')
    .update(updateObj)
    .eq('id', job.id);
  if (upErr) throw new Error('db_update_failed: ' + upErr.message);

  console.log(
    JSON.stringify({
      diag_id: diagId,
      stage: 'db',
      debug: { job_id, preview_url, print_jpg_url, pdf_url },
    })
  );

  return res.status(200).json({
    ok: true,
    job_id,
    preview_url,
    print_jpg_url,
    pdf_url,
  });
} catch (e) {
    console.error('finalize-assets error', { diagId, stage, error: e });
    const status = stage === 'download_src' ? 502 : 500;
    const msgMap = {
      download_src: 'download_failed',
      compose: 'compose_failed',
      print_export: 'print_export_failed',
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

