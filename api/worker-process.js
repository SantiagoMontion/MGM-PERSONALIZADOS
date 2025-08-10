// /api/worker-process.js
// Requiere: sharp, pdf-lib, supabase-js v2, "type":"module"
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { supa } from '../lib/supa.js';
import { cmToPx, mmToPx } from '../lib/units.js';
import { parseSupabaseObject } from '../lib/storage.js';

const BLEED_MM_DEFAULT = Number(process.env.DEFAULT_BLEED_MM || 3);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (req.headers['authorization'] !== `Bearer ${process.env.WORKER_TOKEN}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { job_id_uuid } = await readJson(req); // uuid interno (no el job_id legible)

    if (!job_id_uuid) return res.status(400).json({ error: 'missing_job_id_uuid' });

    // 1) Traer el job
    const { data: job, error: jErr } = await supa
      .from('jobs')
      .select('*')
      .eq('id', job_id_uuid)
      .single();
    if (jErr || !job) return res.status(404).json({ error: 'job_not_found' });

    // Evitar reprocesar si ya tiene salidas
    if (job.print_jpg_url && job.pdf_url) {
      return res.status(200).json({ ok: true, already_done: true });
    }

    // 2) Descargar original del bucket uploads
    const { bucket, key } = parseSupabaseObject(job.file_original_url);
    if (bucket !== 'uploads') return res.status(400).json({ error: 'invalid_bucket' });

    const dl = await supa.storage.from(bucket).download(key);
    if (dl.error) return res.status(500).json({ error: 'download_failed', detail: dl.error.message });
    const inputBuf = await dl.data.arrayBuffer().then(b => Buffer.from(b));

    // 3) Normalizar + preparar dimensiones destino (300DPI + sangrado)
    const dpi = 300;
    const bleedMm = Number(job.bleed_mm || BLEED_MM_DEFAULT);
    const bleedPx = mmToPx(bleedMm, dpi);
    const targetW = cmToPx(Number(job.w_cm), dpi) + bleedPx * 2;
    const targetH = cmToPx(Number(job.h_cm), dpi) + bleedPx * 2;

    // Leer metadata del original
    const meta = await sharp(inputBuf, { failOn: 'none' }).rotate().toBuffer({ resolveWithObject: true });
    const src = sharp(meta.data).withMetadata({ orientation: 1 }); // rotado/normalizado, sRGB por defecto

    // 4) Fit: cover/contain según job.fit_mode
    let fitted;
    if (job.fit_mode === 'contain') {
      const bg = job.bg || '#ffffff';
      fitted = await src
        .resize(targetW, targetH, { fit: 'contain', background: bg })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
    } else {
      // cover (recorta)
      fitted = await src
        .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
    }

    // 5) Generar PDF (página del tamaño final SIN sangrado)
    const pdf = await PDFDocument.create();
    const pageWpt = (Number(job.w_cm) / 2.54) * 72;
    const pageHpt = (Number(job.h_cm) / 2.54) * 72;
    const page = pdf.addPage([pageWpt, pageHpt]);

    // Para el PDF usamos la imagen sin sangrado visible: recortamos bordes bleedPx
    // (si querés dejar el bleed visible en PDF, cambiar este bloque)
    const noBleed = await sharp(fitted)
      .extract({ left: bleedPx, top: bleedPx, width: targetW - bleedPx*2, height: targetH - bleedPx*2 })
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();

    const jpgEmbed = await pdf.embedJpg(noBleed);
    page.drawImage(jpgEmbed, { x: 0, y: 0, width: pageWpt, height: pageHpt });
    const pdfBytes = await pdf.save();

    // 6) Preview (WebP ~1600px)
    const maxPreview = 1600;
    const scale = Math.min(1, maxPreview / Math.max(targetW, targetH));
    const prevW = Math.round(targetW * scale);
    const prevH = Math.round(targetH * scale);
    const preview = await sharp(fitted)
      .resize(prevW, prevH)
      .webp({ quality: 82 })
      .toBuffer();

    // 7) Subir outputs a bucket 'outputs'
    const hash8 = (job.file_hash || '').slice(0, 8);
    const base = `outputs`;
    const printKey = `print/${job.job_id}/print_${Number(job.w_cm)}x${Number(job.h_cm)}_${hash8}.jpg`;
    const pdfKey   = `pdf/${job.job_id}/print_${Number(job.w_cm)}x${Number(job.h_cm)}_${hash8}.pdf`;
    const prevKey  = `mockup/${job.job_id}/preview_${hash8}.webp`;

    // subidas
    await mustOk(supa.storage.from(base).upload(printKey, fitted, { contentType: 'image/jpeg', upsert: true }));
    await mustOk(supa.storage.from(base).upload(pdfKey,   Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true }));
    await mustOk(supa.storage.from(base).upload(prevKey,  preview, { contentType: 'image/webp', upsert: true }));

    const publicBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/${base}`;
    const printUrl = `${publicBase}/${printKey}`;
    const pdfUrl   = `${publicBase}/${pdfKey}`;
    const prevUrl  = `${publicBase}/${prevKey}`;

    // 8) Actualizar job con URLs y status
    await supa.from('jobs').update({
      print_jpg_url: printUrl,
      pdf_url: pdfUrl,
      preview_url: prevUrl,
      status: 'READY_FOR_PRODUCTION'
    }).eq('id', job.id);

    await supa.from('job_events').insert({
      job_id: job.id,
      event: 'ASSETS_GENERATED',
      detail: { print_jpg_url: printUrl, pdf_url: pdfUrl, preview_url: prevUrl }
    });

    return res.status(200).json({ ok: true, job_id: job.job_id, print_jpg_url: printUrl, pdf_url: pdfUrl, preview_url: prevUrl });

  } catch (e) {
    console.error('worker_error', e);
    return res.status(500).json({ error: 'worker_failed', detail: String(e?.message || e) });
  }
}

/* helpers */
async function readJson(req){
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}
async function mustOk(result){
  if (result.error) throw new Error(result.error.message || String(result.error));
}
