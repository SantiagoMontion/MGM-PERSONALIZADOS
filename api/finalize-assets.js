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
    print: `${printBase}/${slug}-${size}-${material}.png`,
    mock1080: `${mockBase}/${slug}-1080.jpg`,
  };
}

function err(res, status, { diag_id, stage, message, hints = [], debug = {} }) {
  return res.status(status).json({ ok: false, diag_id, stage, message, hints, debug });
}

function isPosFinite(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
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
  let printBuf;
  try {
    const comp = await composeImage({ render_v2, srcBuf });
    ({ printBuf, debug } = comp);
    console.log(
      JSON.stringify({ diag_id: diagId, stage: 'compose', debug })
    );
  } catch (e) {
    if (e?.message === 'invalid_bbox') {
      debug = e.debug || {};
      return err(res, 400, { diag_id: diagId, stage, message: 'invalid_bbox', debug });
    }
    throw e;
  }

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
  const out = buildOutputPaths({
    job_id,
    slug,
    w_cm: job.w_cm,
    h_cm: job.h_cm,
    material: job.material,
  });
  const upPrint = await supa.storage
    .from('outputs')
    .upload(out.print.replace(/^outputs\//, ''), printBuf, {
      contentType: 'image/png',
      upsert: true,
    });
  if (upPrint.error)
    throw new Error('upload_print_failed: ' + upPrint.error.message);
  if (mock1080Buf) {
    const upMock = await supa.storage
      .from('outputs')
      .upload(out.mock1080.replace(/^outputs\//, ''), mock1080Buf, {
        contentType: 'image/jpeg',
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
  const print_jpg_url = `${baseUrl}/storage/v1/object/public/${out.print}`;
  const updateObj = {
    preview_url,
    print_jpg_url,
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
      debug: { job_id, preview_url, print_jpg_url },
    })
  );

  return res.status(200).json({
    ok: true,
    job_id,
    preview_url,
    print_jpg_url,
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

