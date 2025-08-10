// /api/worker-process.js (debug detallado)
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { supa } from '../lib/supa.js';
import { cmToPx, mmToPx } from '../lib/units.js';

async function readJson(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}
async function mustOk(result, step){
  if (result.error) throw new Error(`${step}: ${result.error.message || String(result.error)}`);
}
export default async function handler(req, res) {
  const step = { name: 'start' };
  try {
    // 0) método y token
    step.name='auth';
    if (req.method !== 'POST') return res.status(405).json({ step: step.name, error: 'method_not_allowed' });
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.WORKER_TOKEN}`) {
      return res.status(401).json({ step: step.name, error: 'unauthorized' });
    }

    // 1) body y job
    step.name='read_json';
    const body = await readJson(req);
    if (!body?.job_id_uuid) return res.status(400).json({ step: step.name, error: 'missing_job_id_uuid' });

    step.name='load_job';
    const { data: job, error: jErr } = await supa.from('jobs').select('*').eq('id', body.job_id_uuid).single();
    if (jErr || !job) return res.status(404).json({ step: step.name, error: String(jErr?.message || 'job_not_found') });

    if (job.print_jpg_url && job.pdf_url) {
      return res.status(200).json({ ok:true, step:'already_done', job_id:job.job_id });
    }

    // 2) descargar original
    step.name='download_original';
    const m = (job.file_original_url||'').match(/\/storage\/v1\/object\/(private|public)\/([^/]+)\/(.+)$/);
    if (!m) return res.status(400).json({ step: step.name, error: 'invalid_supabase_storage_url' });
    const [, vis, bucket, key] = m;
    if (bucket !== 'uploads') return res.status(400).json({ step: step.name, error: 'invalid_bucket', bucket });
    const dl = await supa.storage.from(bucket).download(key);
    if (dl.error) return res.status(500).json({ step: step.name, error: String(dl.error?.message || dl.error) });
    const inputBuf = Buffer.from(await dl.data.arrayBuffer());

    // 3) preparar dimensiones
    step.name='prepare_dims';
    const dpi=300;
    const bleedPx = Math.max(0, Math.round(((Number(job.bleed_mm||3)/10)/2.54)*dpi));
    const targetW = Math.round((Number(job.w_cm)/2.54)*dpi) + bleedPx*2;
    const targetH = Math.round((Number(job.h_cm)/2.54)*dpi) + bleedPx*2;

    // 4) normalizar + fit
    step.name='sharp_normalize';
    const norm = await sharp(inputBuf, { failOn: 'none' }).rotate().withMetadata({ orientation:1 });

    step.name='sharp_fit';
    let fitted;
    if (job.fit_mode === 'contain') {
      const bg = job.bg || '#ffffff';
      fitted = await norm.resize(targetW, targetH, { fit:'contain', background:bg }).jpeg({ quality:95, mozjpeg:true }).toBuffer();
    } else {
      fitted = await norm.resize(targetW, targetH, { fit:'cover', position:'centre' }).jpeg({ quality:95, mozjpeg:true }).toBuffer();
    }

    // 5) recorte sin sangrado para PDF
    step.name='sharp_extract_pdf';
    const widthNB = Math.max(1, targetW - bleedPx*2);
    const heightNB = Math.max(1, targetH - bleedPx*2);
    const noBleed = await sharp(fitted).extract({ left: bleedPx, top: bleedPx, width: widthNB, height: heightNB })
      .jpeg({ quality:95, mozjpeg:true }).toBuffer();

    // 6) armar PDF
    step.name='pdf_build';
    const pdf = await PDFDocument.create();
    const pageWpt = (Number(job.w_cm)/2.54)*72;
    const pageHpt = (Number(job.h_cm)/2.54)*72;
    const page = pdf.addPage([pageWpt, pageHpt]);
    const jpg = await pdf.embedJpg(noBleed);
    page.drawImage(jpg, { x:0, y:0, width:pageWpt, height:pageHpt });
    const pdfBytes = await pdf.save();

    // 7) preview
    step.name='sharp_preview';
    const maxPreview = 1600;
    const scale = Math.min(1, maxPreview / Math.max(targetW, targetH));
    const prevW = Math.max(1, Math.round(targetW*scale));
    const prevH = Math.max(1, Math.round(targetH*scale));
    const preview = await sharp(fitted).resize(prevW, prevH).webp({ quality:82 }).toBuffer();

    // 8) subir outputs
    step.name='upload_outputs';
    const hash8 = (job.file_hash||'').slice(0,8);
    const base = 'outputs';
    const printKey = `print/${job.job_id}/print_${Number(job.w_cm)}x${Number(job.h_cm)}_${hash8}.jpg`;
    const pdfKey   = `pdf/${job.job_id}/print_${Number(job.w_cm)}x${Number(job.h_cm)}_${hash8}.pdf`;
    const prevKey  = `mockup/${job.job_id}/preview_${hash8}.webp`;

    await mustOk(await supa.storage.from(base).upload(printKey, fitted, { contentType:'image/jpeg', upsert:true }), 'upload_print');
    await mustOk(await supa.storage.from(base).upload(pdfKey, Buffer.from(pdfBytes), { contentType:'application/pdf', upsert:true }), 'upload_pdf');
    await mustOk(await supa.storage.from(base).upload(prevKey, preview, { contentType:'image/webp', upsert:true }), 'upload_preview');

    const publicBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/${base}`;
    const printUrl = `${publicBase}/${printKey}`;
    const pdfUrl   = `${publicBase}/${pdfKey}`;
    const prevUrl  = `${publicBase}/${prevKey}`;

    // 9) actualizar DB
    step.name='update_db';
    await mustOk(await supa.from('jobs').update({
      print_jpg_url: printUrl,
      pdf_url: pdfUrl,
      preview_url: prevUrl,
      status: 'READY_FOR_PRODUCTION'
    }).eq('id', job.id), 'update_job');

    await mustOk(await supa.from('job_events').insert({
      job_id: job.id,
      event: 'ASSETS_GENERATED',
      detail: { print_jpg_url: printUrl, pdf_url: pdfUrl, preview_url: prevUrl }
    }), 'insert_event');

    // listo
    return res.status(200).json({ ok:true, step:'done', job_id: job.job_id, print_jpg_url: printUrl, pdf_url: pdfUrl, preview_url: prevUrl });
  } catch (e) {
    return res.status(500).json({ step: 'crash_at_'+(e.message?.split(':')[0] || 'unknown') , error: String(e?.message || e) });
  }
}
