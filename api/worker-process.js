// /api/worker-process.js  (dynamic import + pasos)
import crypto from 'node:crypto';
import { supa } from '../lib/supa';
import { buildCorsHeaders, preflight, applyCorsToResponse } from '../lib/cors';
import { slugifyName } from './_lib/slug';

async function readJson(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  const origin = req.headers.origin || null;
  const cors = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }
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
    const DPI = 300;
    const w_cm = Number(job.w_cm);
    const h_cm = Number(job.h_cm);
    const out_w_cm = w_cm + 2;
    const out_h_cm = h_cm + 2;
    const inner_w_px = Math.round((w_cm * DPI) / 2.54);
    const inner_h_px = Math.round((h_cm * DPI) / 2.54);
    const out_w_px = Math.round((out_w_cm * DPI) / 2.54);
    const out_h_px = Math.round((out_h_cm * DPI) / 2.54);
    const scaleX = out_w_px / inner_w_px;
    const scaleY = out_h_px / inner_h_px;
    const pageWpt = (out_w_cm / 2.54) * 72;
    const pageHpt = (out_h_cm / 2.54) * 72;
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
      page_w: pageWpt,
      page_h: pageHpt,
    });

    // 5) Normalizar + aplicar layout
    step.name='sharp_fit';
    let inner;
    if (layout?.transform && layout?.image?.natural_px) {
      const bg = layout.mode === 'contain' ? (layout.background || '#ffffff') : '#ffffff';
      const base = sharp({
        create: { width: inner_w_px, height: inner_h_px, channels: 3, background: bg }
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
      const left = Math.round((layout.transform.x_cm / 2.54) * DPI + dx);
      const top  = Math.round((layout.transform.y_cm / 2.54) * DPI + dy);

      inner = await base
        .composite([{ input: imgBuf, left, top }])
        .jpeg({ quality:95, mozjpeg:true })
        .toBuffer();
    } else {
      const norm = sharp(inputBuf, { failOn: 'none' }).rotate().withMetadata({ orientation:1 });
      inner = await norm
        .resize(inner_w_px, inner_h_px, { fit: (job.fit_mode==='contain'?'contain':'cover'), background: (job.bg||'#ffffff'), position:'centre' })
        .jpeg({ quality:95, mozjpeg:true })
        .toBuffer();
    }

    // 6) Escalar a salida física y generar JPG/PDF
    step.name='pdf_build';
    const stretchedPng = await sharp(inner)
      .resize({ width: out_w_px, height: out_h_px, fit: 'fill' })
      .png()
      .toBuffer();
    const printJpgBuf = await sharp(stretchedPng)
      .jpeg({ quality:88, mozjpeg:true })
      .toBuffer();
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([pageWpt, pageHpt]);
    const jpg = await pdf.embedJpg(printJpgBuf);
    page.drawImage(jpg, { x:0, y:0, width:pageWpt, height:pageHpt });
    const pdfBytes = await pdf.save();

    // 7) Preview / mockup 1080x1080
    step.name='preview';
    let preview;
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
      preview = await sharp({
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
      preview = stretchedPng;
    }

    // 8) Subir a outputs
    step.name='upload';
    const hash8 = (job.file_hash||'').slice(0,8);
    const base='outputs';
    const printKey = `print/${job.job_id}/print_${Number(job.w_cm)}x${Number(job.h_cm)}_${hash8}.jpg`;
    const pdfKey   = `pdf/${job.job_id}/print_${Number(job.w_cm)}x${Number(job.h_cm)}_${hash8}.pdf`;
    const slug = slugifyName(job.design_name || 'design');
    const prevKey  = `mock/${job.job_id}/${slug}-1080.png`;

    const up1 = await supa.storage.from(base).upload(printKey, printJpgBuf, { contentType:'image/jpeg', upsert:true });
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
