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
    const { job_id } = body;
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

    if (job.preview_url && job.print_jpg_url && job.pdf_url) {
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
    const download = await fetch(signed.signedUrl);
    if (!download.ok) {
      throw new Error('download_failed: ' + download.status);
    }
    const buf = Buffer.from(await download.arrayBuffer());

    stage = 'process';
    let previewBuf, printBuf, pdfBuf;
    try {
      previewBuf = await sharp(buf)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      printBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
    } catch (err) {
      printBuf = buf;
      try {
        previewBuf = await sharp(buf).jpeg({ quality: 80 }).toBuffer();
      } catch {
        previewBuf = buf;
      }
    }
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
    const { error: upErr } = await supa
      .from('jobs')
      .update({ preview_url, print_jpg_url, pdf_url, status: 'READY_FOR_PRINT' })
      .eq('id', job.id);
    if (upErr) throw new Error('db_update_failed: ' + upErr.message);

    return res.status(200).json({
      ok: true,
      job_id,
      preview_url,
      print_jpg_url,
      pdf_url,
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
