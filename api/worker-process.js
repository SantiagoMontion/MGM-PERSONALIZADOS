// /api/worker-process.js  (dynamic import + pasos)
import { supa } from '../lib/supa.js';
import { cors } from '../lib/cors.js';

async function readJson(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${process.env.WORKER_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const step = { name: 'start' };
  try {
    const body = await readJson(req);
    const jobUUID = body?.job_id_uuid;
    if (!jobUUID) return res.status(400).json({ step: 'body', error: 'missing_job_id_uuid' });

    // 1) Cargar job
    step.name='load_job';
    const { data: job, error: jErr } = await supa.from('jobs').select('*').eq('id', jobUUID).single();
    if (jErr || !job) return res.status(404).json({ step: step.name, error: String(jErr?.message || 'job_not_found') });

    // 2) Descargar original
    step.name='download';
    const m = (job.file_original_url||'').match(/\/storage\/v1\/object\/(private|public)\/([^/]+)\/(.+)$/);
    if (!m) return res.status(400).json({ step: step.name, error: 'invalid_supabase_storage_url' });
    const [, vis, bucket, key] = m;
    const dl = await supa.storage.from(bucket).download(key);
    if (dl.error) return res.status(500).json({ step: step.name, error: String(dl.error?.message || dl.error) });
    const inputBuf = Buffer.from(await dl.data.arrayBuffer());

    // 3) IMPORTS DINÁMICOS (para que no crashee al cargar la función)
    step.name='import_libs';
    const sharp = (await import('sharp')).default;
    const { PDFDocument } = await import('pdf-lib');

    const layout = job.layout_json || null;

    // 4) Preparar dimensiones
    step.name='prepare_dims';
    const dpi = Number(layout?.dpi || 300);
    const bleedPx = Math.max(0, Math.round(((Number(job.bleed_mm||3)/10)/2.54)*dpi));
    const targetW = Math.round((Number(job.w_cm)/2.54)*dpi) + bleedPx*2;
    const targetH = Math.round((Number(job.h_cm)/2.54)*dpi) + bleedPx*2;

    // 5) Normalizar + aplicar layout
    step.name='sharp_fit';
    let fitted;
    if (layout?.transform && layout?.image?.natural_px) {
      const bg = layout.mode === 'contain' ? (layout.background || '#ffffff') : '#ffffff';
      const base = sharp({
        create: { width: targetW, height: targetH, channels: 3, background: bg }
      });

      const scaledW = Math.round(layout.image.natural_px.w * layout.transform.scaleX);
      const scaledH = Math.round(layout.image.natural_px.h * layout.transform.scaleY);
      const imgBuf = await sharp(inputBuf, { failOn: 'none' })
        .rotate()
        .resize(scaledW, scaledH)
        .rotate(layout.transform.rotation_deg || 0, { background: bg })
        .toBuffer();

      const theta = (layout.transform.rotation_deg || 0) * Math.PI / 180;
      const rotW = Math.abs(scaledW * Math.cos(theta)) + Math.abs(scaledH * Math.sin(theta));
      const rotH = Math.abs(scaledW * Math.sin(theta)) + Math.abs(scaledH * Math.cos(theta));
      const dx = (scaledW - rotW) / 2;
      const dy = (scaledH - rotH) / 2;
      const left = Math.round((layout.transform.x_cm / 2.54) * dpi + dx);
      const top  = Math.round((layout.transform.y_cm / 2.54) * dpi + dy);

      fitted = await base
        .composite([{ input: imgBuf, left, top }])
        .jpeg({ quality:95, mozjpeg:true })
        .toBuffer();
    } else {
      const norm = sharp(inputBuf, { failOn: 'none' }).rotate().withMetadata({ orientation:1 });
      fitted = await norm
        .resize(targetW, targetH, { fit: (job.fit_mode==='contain'?'contain':'cover'), background: (job.bg||'#ffffff'), position:'centre' })
        .jpeg({ quality:95, mozjpeg:true })
        .toBuffer();
    }

    // 6) PDF (sin sangrado visible)
    step.name='pdf_build';
    const noBleedW = Math.max(1, targetW - bleedPx*2);
    const noBleedH = Math.max(1, targetH - bleedPx*2);
    const noBleed = await sharp(fitted).extract({ left: bleedPx, top: bleedPx, width: noBleedW, height: noBleedH }).jpeg({ quality:95, mozjpeg:true }).toBuffer();
    const pdf = await PDFDocument.create();
    const pageWpt = (Number(job.w_cm)/2.54)*72;
    const pageHpt = (Number(job.h_cm)/2.54)*72;
    const page = pdf.addPage([pageWpt, pageHpt]);
    const jpg = await pdf.embedJpg(noBleed);
    page.drawImage(jpg, { x:0, y:0, width:pageWpt, height:pageHpt });
    const pdfBytes = await pdf.save();

    // 7) Preview / mockup 1080x1080
    step.name='preview';
    const mockSize = 1080;
    const scale = Math.min(mockSize / targetW, mockSize / targetH);
    const mockW = Math.max(1, Math.round(targetW * scale));
    const mockH = Math.max(1, Math.round(targetH * scale));
    const resized = await sharp(fitted).resize(mockW, mockH).png().toBuffer();
    const left = Math.round((mockSize - mockW) / 2);
    const top = Math.round((mockSize - mockH) / 2);
    const preview = await sharp({
      create: {
        width: mockSize,
        height: mockSize,
        channels: 3,
        background: job.bg || '#ffffff'
      }
    })
      .composite([{ input: resized, left, top }])
      .png()
      .toBuffer();

    // 8) Subir a outputs
    step.name='upload';
    const hash8 = (job.file_hash||'').slice(0,8);
    const base='outputs';
    const printKey = `print/${job.job_id}/print_${Number(job.w_cm)}x${Number(job.h_cm)}_${hash8}.jpg`;
    const pdfKey   = `pdf/${job.job_id}/print_${Number(job.w_cm)}x${Number(job.h_cm)}_${hash8}.pdf`;
    const prevKey  = `mockup/${job.job_id}/preview_${hash8}.png`;

    const up1 = await supa.storage.from(base).upload(printKey, fitted, { contentType:'image/jpeg', upsert:true });
    if (up1.error) return res.status(500).json({ step: step.name, error: up1.error.message || String(up1.error) });
    const up2 = await supa.storage.from(base).upload(pdfKey, Buffer.from(pdfBytes), { contentType:'application/pdf', upsert:true });
    if (up2.error) return res.status(500).json({ step: step.name, error: up2.error.message || String(up2.error) });
    const up3 = await supa.storage.from(base).upload(prevKey, preview, { contentType:'image/png', upsert:true });
    if (up3.error) return res.status(500).json({ step: step.name, error: up3.error.message || String(up3.error) });

    const publicBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/${base}`;
    const printUrl = `${publicBase}/${printKey}`;
    const pdfUrl   = `${publicBase}/${pdfKey}`;
    const prevUrl  = `${publicBase}/${prevKey}`;

    // 9) Update DB
    step.name='update_db';
    const upDb = await supa.from('jobs').update({
      print_jpg_url: printUrl,
      pdf_url: pdfUrl,
      preview_url: prevUrl,
      status: 'READY_FOR_PRODUCTION'
    }).eq('id', job.id);
    if (upDb.error) return res.status(500).json({ step: step.name, error: upDb.error.message || String(upDb.error) });

    // 10) Disparar creación de enlaces (sin bloquear la respuesta)
    fetch(`${process.env.API_BASE_URL}/api/create-cart-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.job_id })
    }).catch(() => {});

    // Crear checkout automáticamente
    fetch(`${process.env.API_BASE_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.job_id })
    }).catch(() => {});

    // b) Producto público SI el cliente marcó publicar
    if (job.is_public) {
      fetch(`${process.env.API_BASE_URL}/api/publish-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id })
      }).catch(() => {});
    }

    return res.status(200).json({ ok:true, step:'done', job_id: job.job_id, print_jpg_url: printUrl, pdf_url: pdfUrl, preview_url: prevUrl });

  } catch (e) {
    return res.status(500).json({ step: 'crash_'+(e?.message?.split(':')[0]||'unknown'), error: String(e?.message || e) });
  }



  

}
