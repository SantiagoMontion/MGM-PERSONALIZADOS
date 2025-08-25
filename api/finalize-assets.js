// api/finalize-assets.js
import { cors } from './_lib/cors.js';
import getSupabaseAdmin from './_lib/supabaseAdmin.js';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

function parseUploadsObjectKeyFromCanonical(url) {
  try {
    const u = new URL(url);
    let p = u.pathname;
    // /storage/v1/object/uploads/<object_key>
    return p.replace(/^\/storage\/v1\/object\/uploads\//, '');
  } catch {
    return '';
  }
}

function buildOutputPaths({ job_id, ext = 'jpg' }) {
  // Carpeta por mes (YYYY/MM) y base por job_id (suficiente para demo)
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const base = `outputs/${yyyy}/${mm}/${job_id}`;
  return {
    preview: `${base}-preview.jpg`,
    print: `${base}-print.jpg`,
    pdf: `${base}-file.pdf`,
    mock1080: `${base}-mock_1080.jpg`,
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : req.body || {};
    const { job_id, render } = body;
    if (!job_id)
      return res.status(400).json({ ok: false, error: 'missing_job_id' });

    const supa = getSupabaseAdmin();

    // 1) Cargar job
    const { data: job, error: jobErr } = await supa
      .from('jobs')
      .select(
        'id, job_id, file_original_url, preview_url, print_jpg_url, pdf_url, w_cm, h_cm, material, status'
      )
      .eq('job_id', job_id)
      .maybeSingle();
    if (jobErr)
      return res
        .status(500)
        .json({ ok: false, error: 'db_error', detail: jobErr.message });
    if (!job)
      return res.status(404).json({ ok: false, error: 'job_not_found' });

    // Si ya está listo, salir idempotente
    if (
      job.preview_url &&
      job.print_jpg_url &&
      job.pdf_url &&
      (!render || job.mock_1080_url)
    ) {
      return res.status(200).json({
        ok: true,
        already: true,
        job_id,
        preview_url: job.preview_url,
        print_jpg_url: job.print_jpg_url,
        pdf_url: job.pdf_url,
        mock_1080_url: job.mock_1080_url,
      });
    }

    // 2) Obtener original desde 'uploads' (privado)
    const objectKey = parseUploadsObjectKeyFromCanonical(
      job.file_original_url || ''
    );
    if (!objectKey)
      return res.status(400).json({ ok: false, error: 'bad_original_url' });

    // Link firmado corto para descargar el binario
    const { data: signed, error: signErr } = await supa.storage
      .from('uploads')
      .createSignedUrl(objectKey, 60);
    if (signErr)
      return res
        .status(500)
        .json({ ok: false, error: 'signed_url_error', detail: signErr.message });

    const download = await fetch(signed.signedUrl);
    if (!download.ok)
      return res
        .status(502)
        .json({ ok: false, error: 'download_failed', status: download.status });
    const buf = Buffer.from(await download.arrayBuffer());

    // 3) Generar assets con sharp/pdf-lib
    let previewBuf, printBuf, pdfBuf, mockBuf;
    if (render) {
      const srcW = Number(render?.src_px?.w) || 0;
      const srcH = Number(render?.src_px?.h) || 0;
      const crop = render?.crop_px || {};
      const left = Math.max(0, Math.min(srcW, Math.round(crop.left || 0)));
      const top = Math.max(0, Math.min(srcH, Math.round(crop.top || 0)));
      const width = Math.max(
        1,
        Math.min(srcW - left, Math.round(crop.width || srcW))
      );
      const height = Math.max(
        1,
        Math.min(srcH - top, Math.round(crop.height || srcH))
      );
      const rotate = [0, 90, 180, 270].includes(render.rotate_deg)
        ? render.rotate_deg
        : 0;
      const fit =
        render.fit_mode === 'contain'
          ? 'contain'
          : render.fit_mode === 'stretch'
          ? 'fill'
          : 'cover';
      const bg = render.bg || '#ffffff';
      const bleedCm = (Number(render.bleed_mm) || 0) / 10;
      const w_cm = Number(render.w_cm) || Number(job.w_cm) || 0;
      const h_cm = Number(render.h_cm) || Number(job.h_cm) || 0;
      const dpi = 300;
      const w_px = Math.round(((w_cm + 2 * bleedCm) * dpi) / 2.54);
      const h_px = Math.round(((h_cm + 2 * bleedCm) * dpi) / 2.54);

      const base = sharp(buf)
        .extract({ left, top, width, height })
        .rotate(rotate);

      printBuf = await base
        .clone()
        .resize(w_px, h_px, { fit, background: bg })
        .jpeg({ quality: 92 })
        .toBuffer();

      previewBuf = await sharp(printBuf)
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer();

      const pdfDoc = await PDFDocument.create();
      const jpg = await pdfDoc.embedJpg(printBuf);
      const widthPdf = jpg.width;
      const heightPdf = jpg.height;
      const page = pdfDoc.addPage([widthPdf, heightPdf]);
      page.drawImage(jpg, { x: 0, y: 0, width: widthPdf, height: heightPdf });
      pdfBuf = await pdfDoc.save();

      const pxPerCm = Math.floor((1080 * 0.85) / Math.max(w_cm, h_cm));
      const imgW = Math.round(w_cm * pxPerCm);
      const imgH = Math.round(h_cm * pxPerCm);
      const mockResized = await base
        .clone()
        .resize(imgW, imgH, { fit, background: bg })
        .jpeg({ quality: 90 })
        .toBuffer();
      mockBuf = await sharp({
        create: {
          width: 1080,
          height: 1080,
          channels: 3,
          background: '#ffffff',
        },
      })
        .composite([
          {
            input: mockResized,
            left: Math.round((1080 - imgW) / 2),
            top: Math.round((1080 - imgH) / 2),
          },
        ])
        .jpeg({ quality: 90 })
        .toBuffer();
    } else {
      // Comportamiento retrocompatible
      previewBuf = await sharp(buf)
        .jpeg({ quality: 82 })
        .resize({ width: 1200, withoutEnlargement: true })
        .toBuffer();
      printBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
      const pdfDoc = await PDFDocument.create();
      const jpg = await pdfDoc.embedJpg(printBuf);
      const width = jpg.width;
      const height = jpg.height;
      const page = pdfDoc.addPage([width, height]);
      page.drawImage(jpg, { x: 0, y: 0, width, height });
      pdfBuf = await pdfDoc.save();
    }

    // 4) Subir a bucket 'outputs' (público)
    const out = buildOutputPaths({ job_id });
    const upPrev = await supa.storage
      .from('outputs')
      .upload(out.preview.replace(/^outputs\//, ''), previewBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (upPrev.error)
      return res.status(500).json({
        ok: false,
        error: 'upload_preview_failed',
        detail: upPrev.error.message,
      });

    const upPrint = await supa.storage
      .from('outputs')
      .upload(out.print.replace(/^outputs\//, ''), printBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (upPrint.error)
      return res.status(500).json({
        ok: false,
        error: 'upload_print_failed',
        detail: upPrint.error.message,
      });

    const upPdf = await supa.storage
      .from('outputs')
      .upload(out.pdf.replace(/^outputs\//, ''), pdfBuf, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (upPdf.error)
      return res.status(500).json({
        ok: false,
        error: 'upload_pdf_failed',
        detail: upPdf.error.message,
      });

    let mock_1080_url;
    if (mockBuf) {
      const upMock = await supa.storage
        .from('outputs')
        .upload(out.mock1080.replace(/^outputs\//, ''), mockBuf, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      if (upMock.error)
        return res.status(500).json({
          ok: false,
          error: 'upload_mock_failed',
          detail: upMock.error.message,
        });
    }

    // 5) Public URLs
    const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const preview_url = `${base}/storage/v1/object/public/${out.preview}`;
    const print_jpg_url = `${base}/storage/v1/object/public/${out.print}`;
    const pdf_url = `${base}/storage/v1/object/public/${out.pdf}`;
    if (mockBuf) {
      mock_1080_url = `${base}/storage/v1/object/public/${out.mock1080}`;
    }

    // 6) Actualizar job
    const updatePayload = {
      preview_url,
      print_jpg_url,
      pdf_url,
      status: 'READY_FOR_PRINT',
    };
    if (mock_1080_url) updatePayload.mock_1080_url = mock_1080_url;
    const { error: upErr } = await supa
      .from('jobs')
      .update(updatePayload)
      .eq('id', job.id);
    if (upErr)
      return res.status(500).json({
        ok: false,
        error: 'db_update_failed',
        detail: upErr.message,
      });

    return res.status(200).json({
      ok: true,
      job_id,
      preview_url,
      print_jpg_url,
      pdf_url,
      mock_1080_url,
    });
  } catch (e) {
    console.error('finalize-assets error', e);
    return res
      .status(500)
      .json({ ok: false, error: 'unexpected', detail: String(e?.message || e) });
  }
}

