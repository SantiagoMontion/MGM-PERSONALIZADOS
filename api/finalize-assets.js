// api/finalize-assets.js
import { cors } from './_lib/cors.js';
import getSupabaseAdmin from './_lib/supabaseAdmin.js';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import crypto from 'node:crypto';

function parseUploadsObjectKeyFromCanonical(url) {
  try {
    const u = new URL(url);
    let p = u.pathname;
    return p.replace(/^\/storage\/v1\/object\/uploads\//, '');
  } catch {
    return '';
  }
}

function buildOutputPaths({ job_id }) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const base = `outputs/${yyyy}/${mm}/${job_id}`;
  return {
    preview: `${base}-preview.jpg`,
    print: `${base}-print.jpg`,
    pdf: `${base}-file.pdf`,
    mock1080: `${base}-mock_1080.png`,
  };
}

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res
      .status(405)
      .json({ ok: false, diag_id: diagId, stage: 'method', error: 'method_not_allowed' });
  }

  let stage = 'load';
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { job_id, render_v2 } = body;
    if (!job_id) {
      return res
        .status(400)
        .json({ ok: false, diag_id: diagId, stage: 'validate', error: 'missing_job_id' });
    }
    const supa = getSupabaseAdmin();

    stage = 'load';
    const { data: job, error: jobErr } = await supa
      .from('jobs')
      .select(
        'id, job_id, file_original_url, preview_url, print_jpg_url, pdf_url, status'
      )
      .eq('job_id', job_id)
      .maybeSingle();
    if (jobErr) {
      throw new Error('db_error: ' + jobErr.message);
    }
    if (!job) {
      return res
        .status(404)
        .json({ ok: false, diag_id: diagId, stage: 'load', error: 'job_not_found' });
    }

    if (job.print_jpg_url && job.pdf_url) {
      return res.status(200).json({
        ok: true,
        already: true,
        job_id,
        preview_url: job.preview_url,
        print_jpg_url: job.print_jpg_url,
        pdf_url: job.pdf_url,
      });
    }

    stage = 'signed_url';
    const objectKey = parseUploadsObjectKeyFromCanonical(job.file_original_url || '');
    if (!objectKey) {
      return res
        .status(400)
        .json({ ok: false, diag_id: diagId, stage: 'signed_url', error: 'bad_original_url' });
    }
    const { data: signed, error: signErr } = await supa.storage
      .from('uploads')
      .createSignedUrl(objectKey, 60);
    if (signErr) {
      throw new Error('signed_url_error: ' + signErr.message);
    }

    stage = 'download';
    const download = await fetch(signed.signedUrl, {
      signal: AbortSignal.timeout(15000),
    });
    if (!download.ok) {
      throw new Error('download_failed: ' + download.status);
    }
    const buf = Buffer.from(await download.arrayBuffer());

    stage = 'process';
    let previewBuf, printBuf, pdfBuf, mock1080Buf;
    try {
      if (render_v2) {
        const DPI = 300;
        const bleed_cm = (render_v2?.bleed_mm ?? 3) / 10;
        const out_w_cm = render_v2?.w_cm ?? body.w_cm;
        const out_h_cm = render_v2?.h_cm ?? body.h_cm;
        const bleed_px = Math.round((bleed_cm * DPI) / 2.54);
        const inner_w_px = Math.round((out_w_cm * DPI) / 2.54);
        const inner_h_px = Math.round((out_h_cm * DPI) / 2.54);
        const out_w_px = inner_w_px + 2 * bleed_px;
        const out_h_px = inner_h_px + 2 * bleed_px;

        const canvas_w = render_v2?.canvas_px?.w || inner_w_px;
        const canvas_h = render_v2?.canvas_px?.h || inner_h_px;

        const scaleX = inner_w_px / canvas_w;
        const scaleY = inner_h_px / canvas_h;
        const scale = Math.min(scaleX, scaleY);

        const place = render_v2?.place_px || { x: 0, y: 0, w: canvas_w, h: canvas_h };
        const targetW = Math.max(1, Math.round(place.w * scale));
        const targetH = Math.max(1, Math.round(place.h * scale));
        const targetX = bleed_px + Math.round(place.x * scale);
        const targetY = bleed_px + Math.round(place.y * scale);

        const bgHex =
          render_v2?.fit_mode === 'contain' && render_v2?.bg_hex
            ? render_v2.bg_hex
            : '#000000';

        const base = await sharp({
          create: { width: out_w_px, height: out_h_px, channels: 3, background: bgHex },
        })
          .png()
          .toBuffer();

        const srcRot = await sharp(buf)
          .rotate(render_v2?.rotate_deg ?? 0)
          .toBuffer();

        const placed = await sharp(srcRot)
          .resize({ width: targetW, height: targetH, fit: 'fill' })
          .toBuffer();

        printBuf = await sharp(base)
          .composite([{ input: placed, left: targetX, top: targetY }])
          .jpeg({ quality: 92 })
          .toBuffer();

        previewBuf = await sharp(printBuf)
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        try {
          const PAD = 1080;
          const MARGIN = Math.round(PAD * 0.1);
          const avail = PAD - 2 * MARGIN;
          const ratio = out_w_cm / out_h_cm;
          let padW = avail;
          let padH = Math.round(avail / ratio);
          if (padH > avail) {
            padH = avail;
            padW = Math.round(avail * ratio);
          }
          const padX = Math.round((PAD - padW) / 2);
          const padY = Math.round((PAD - padH) / 2);
          const base1080 = await sharp({
            create: {
              width: PAD,
              height: PAD,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .png()
            .toBuffer();
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
      } else {
        previewBuf = await sharp(buf)
          .resize({ width: 1200, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        printBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
      }
    } catch (e) {
      console.error('finalize-assets main_failed', {
        diagId,
        stage: 'process',
        error: String(e?.message || e),
      });
      const fallbackPrint = await sharp(buf)
        .jpeg({ quality: 90 })
        .toBuffer()
        .catch(() => buf);
      const fallbackPreview = await sharp(buf)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
        .catch(() => buf);
      printBuf = fallbackPrint;
      previewBuf = fallbackPreview;
      mock1080Buf = null;
    }

    stage = 'pdf';
    const pdfDoc = await PDFDocument.create();
    const jpg = await pdfDoc.embedJpg(printBuf);
    const page = pdfDoc.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    pdfBuf = await pdfDoc.save();

    stage = 'upload';
    const out = buildOutputPaths({ job_id });
    const upPrev = await supa.storage
      .from('outputs')
      .upload(out.preview.replace(/^outputs\//, ''), previewBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (upPrev.error) throw new Error('upload_preview_failed: ' + upPrev.error.message);
    const upPrint = await supa.storage
      .from('outputs')
      .upload(out.print.replace(/^outputs\//, ''), printBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (upPrint.error) throw new Error('upload_print_failed: ' + upPrint.error.message);
    const upMock = mock1080Buf
      ? await supa.storage
          .from('outputs')
          .upload(out.mock1080.replace(/^outputs\//, ''), mock1080Buf, {
            contentType: 'image/png',
            upsert: true,
          })
      : { error: null };
    if (upMock.error) throw new Error('upload_mock_failed: ' + upMock.error.message);
    const upPdf = await supa.storage
      .from('outputs')
      .upload(out.pdf.replace(/^outputs\//, ''), pdfBuf, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (upPdf.error) throw new Error('upload_pdf_failed: ' + upPdf.error.message);

    stage = 'db_update';
    const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const preview_url = `${base}/storage/v1/object/public/${out.preview}`;
    const print_jpg_url = `${base}/storage/v1/object/public/${out.print}`;
    const pdf_url = `${base}/storage/v1/object/public/${out.pdf}`;
    const mock_1080_url = mock1080Buf
      ? `${base}/storage/v1/object/public/${out.mock1080}`
      : null;
    const updateObj = { preview_url, print_jpg_url, pdf_url, status: 'READY_FOR_PRINT' };
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
      pdf_url,
      ...(mock_1080_url ? { mock_1080_url } : {}),
    });
  } catch (e) {
    console.error('finalize-assets error', { diagId, stage, error: e });
    return res.status(500).json({
      ok: false,
      diag_id: diagId,
      stage,
      error: String(e?.message || e),
    });
  }
}
