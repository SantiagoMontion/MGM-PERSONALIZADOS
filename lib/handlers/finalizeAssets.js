import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import { slugifyName, sizeLabel } from '../_lib/slug.js';
import composeImage from '../_lib/composeImage.js';
import savePrintPdfToSupabase, { savePrintPreviewToSupabase } from '../_lib/savePrintPdfToSupabase.js';
import { buildPrintStorageDetails } from '../_lib/printNaming.js';
import imageBufferToPdf from '../_lib/imageToPdf.js';
import logger from '../_lib/logger.js';

const OUTPUT_BUCKET = 'outputs';

function toObject(input) {
  if (input && typeof input === 'object') return input;
  if (typeof input === 'string') {
    try { return JSON.parse(input); } catch { return {}; }
  }
  return {};
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseDataUrl(url) {
  const match = /^data:(.+?);base64,(.+)$/.exec(String(url || ''));
  if (!match) throw new Error('invalid_data_url');
  return Buffer.from(match[2], 'base64');
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const err = new Error(`download_failed_${response.status}`);
    err.status = response.status;
    throw err;
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildBaseName(job, body, renderDescriptor) {
  const parts = [];
  const nameSource = body?.design_name
    || body?.designName
    || renderDescriptor?.design_name
    || job?.design_name
    || '';
  const nameSlug = slugifyName(nameSource);
  if (nameSlug) parts.push(nameSlug);

  const width = toNumber(
    body?.width_cm ?? body?.widthCm ?? renderDescriptor?.w_cm ?? job?.w_cm,
  );
  const height = toNumber(
    body?.height_cm ?? body?.heightCm ?? renderDescriptor?.h_cm ?? job?.h_cm,
  );
  if (width && height) parts.push(sizeLabel(width, height));

  const materialSource = body?.mode
    || body?.material
    || renderDescriptor?.material
    || job?.material
    || '';
  const materialSlug = slugifyName(materialSource);
  if (materialSlug) parts.push(materialSlug);

  const base = parts.filter(Boolean).join('-');
  if (base) return base;
  const fallback = slugifyName(job?.job_id || '');
  return fallback || 'design';
}

function normalizeHexColor(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '#ffffff';
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match) return '#ffffff';
  const value = match[1];
  if (value.length === 3) {
    return '#' + value.split('').map((ch) => ch + ch).join('');
  }
  return '#' + value;
}

function sanitizeMaterialValue(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'material';
  const slug = slugifyName(raw);
  return slug || 'material';
}

function formatNumberForKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/0$/, '');
}

function buildPrintsJobKey({ slug, widthCm, heightCm, material, backgroundColor, imageHash }) {
  const widthSegment = formatNumberForKey(widthCm);
  const heightSegment = formatNumberForKey(heightCm);
  return [
    slug || 'diseno',
    widthSegment,
    heightSegment,
    material || 'material',
    backgroundColor || '#ffffff',
    imageHash || 'hash',
  ].join('|');
}

function computeImageHash(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length) {
    return createHash('sha256').update(buffer).digest('hex');
  }
  if (buffer instanceof Uint8Array && buffer.length) {
    return createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  }
  return createHash('sha256').update('empty').digest('hex');
}

export default async function finalizeAssets(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  let payload = toObject(req.body);
  if (!payload || !Object.keys(payload).length) {
    try {
      const raw = await readRawBody(req);
      payload = toObject(raw);
    } catch (err) {
      logger.error('finalize-assets read_body', { diagId, error: err?.message || err });
      return res.status(400).json({ ok: false, diag_id: diagId, message: 'invalid_body' });
    }
  }

  const jobId = typeof payload.job_id === 'string' ? payload.job_id.trim() : '';
  if (!jobId) {
    return res.status(400).json({ ok: false, diag_id: diagId, message: 'missing_job_id' });
  }

  let renderDescriptor = null;
  if (payload.render_v2) {
    if (typeof payload.render_v2 === 'string') {
      try { renderDescriptor = JSON.parse(payload.render_v2); } catch { renderDescriptor = null; }
    } else if (typeof payload.render_v2 === 'object') {
      renderDescriptor = payload.render_v2;
    }
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    logger.error('finalize-assets env', { diagId, error: err?.message || err });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'missing_env' });
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id,job_id,design_name,material,w_cm,h_cm,bleed_mm,file_original_url')
    .eq('job_id', jobId)
    .maybeSingle();

  if (jobErr) {
    logger.error('finalize-assets select', { diagId, error: jobErr.message });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'db_error' });
  }
  if (!job) {
    return res.status(404).json({ ok: false, diag_id: diagId, message: 'job_not_found' });
  }

  const widthCmValue = toNumber(
    payload?.width_cm ?? payload?.widthCm ?? renderDescriptor?.w_cm ?? job?.w_cm,
  );
  const heightCmValue = toNumber(
    payload?.height_cm ?? payload?.heightCm ?? renderDescriptor?.h_cm ?? job?.h_cm,
  );
  const materialValue = payload?.mode
    || payload?.material
    || renderDescriptor?.material
    || job?.material
    || '';
  const designNameSource = payload?.design_name
    || payload?.designName
    || renderDescriptor?.design_name
    || job?.design_name
    || '';
  const slugForStorage = slugifyName(designNameSource) || 'diseno';
  const backgroundColor = String(
    renderDescriptor?.background_color
      ?? renderDescriptor?.backgroundColor
      ?? payload?.backgroundColor
      ?? payload?.background_color
      ?? '#ffffff',
  ).trim() || '#ffffff';
  const normalizedBackgroundColor = normalizeHexColor(backgroundColor);
  const sanitizedMaterial = sanitizeMaterialValue(materialValue);

  const candidateUrls = [
    job.file_original_url || '',
    typeof payload.original_url === 'string' ? payload.original_url : '',
    typeof payload.originalUrl === 'string' ? payload.originalUrl : '',
    typeof payload.file_original_url === 'string' ? payload.file_original_url : '',
    typeof payload.fileOriginalUrl === 'string' ? payload.fileOriginalUrl : '',
    typeof payload.design_url === 'string' ? payload.design_url : '',
    typeof payload.designUrl === 'string' ? payload.designUrl : '',
    renderDescriptor?.design_url ? String(renderDescriptor.design_url) : '',
    renderDescriptor?.designUrl ? String(renderDescriptor.designUrl) : '',
  ];
  const designUrl = candidateUrls.find(u => typeof u === 'string' && u.trim());

  if (!designUrl) {
    return res.status(400).json({ ok: false, diag_id: diagId, message: 'missing_design_url' });
  }

  let sourceBuffer;
  try {
    if (String(designUrl).startsWith('data:')) {
      sourceBuffer = parseDataUrl(designUrl);
    } else {
      sourceBuffer = await fetchBuffer(designUrl);
    }
  } catch (err) {
    logger.error('finalize-assets fetch', { diagId, error: err?.message || err });
    return res.status(400).json({ ok: false, diag_id: diagId, message: 'download_failed' });
  }

  if (!sourceBuffer || !sourceBuffer.length) {
    return res.status(400).json({ ok: false, diag_id: diagId, message: 'empty_source' });
  }

  let printBuffer = sourceBuffer;
  let innerBuffer = null;
  let composeDebug = null;
  if (renderDescriptor && typeof renderDescriptor === 'object') {
    try {
      const composed = await composeImage({ render_v2: renderDescriptor, srcBuf: sourceBuffer });
      printBuffer = composed?.printBuf || sourceBuffer;
      innerBuffer = composed?.innerBuf || null;
      composeDebug = composed?.debug || null;
    } catch (err) {
      logger.warn('finalize-assets compose', { diagId, error: err?.message || err });
      printBuffer = sourceBuffer;
      innerBuffer = null;
    }
  }
  if (!innerBuffer) innerBuffer = printBuffer;

  const marginPerSideCm = 1;
  const widthBaseCm = widthCmValue ?? job?.w_cm ?? null;
  const heightBaseCm = heightCmValue ?? job?.h_cm ?? null;
  let pdfBuffer;
  let previewBuffer;
  try {
    const pdfResult = await imageBufferToPdf({
      buffer: printBuffer,
      density: 300,
      background: normalizedBackgroundColor,
      widthCm: widthBaseCm ?? undefined,
      heightCm: heightBaseCm ?? undefined,
      bleedCm: marginPerSideCm,
      diagId,
    });
    pdfBuffer = pdfResult.pdfBuffer;
    const previewSource = innerBuffer || printBuffer;
    previewBuffer = await sharp(previewSource)
      .resize({ width: 600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70, chromaSubsampling: '4:2:0' })
      .toBuffer();
  } catch (err) {
    logger.error('finalize-assets render', { diagId, error: err?.message || err });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'render_failed' });
  }

  const baseName = buildBaseName(job, payload, renderDescriptor);
  const finalWidthCm = widthBaseCm != null ? widthBaseCm + marginPerSideCm * 2 : null;
  const finalHeightCm = heightBaseCm != null ? heightBaseCm + marginPerSideCm * 2 : null;
  const filenameWidthCm = widthBaseCm ?? job?.w_cm ?? null;
  const filenameHeightCm = heightBaseCm ?? job?.h_cm ?? null;
  const storageDetails = buildPrintStorageDetails({
    slug: slugForStorage,
    widthCm: filenameWidthCm ?? job?.w_cm,
    heightCm: filenameHeightCm ?? job?.h_cm,
    material: sanitizedMaterial,
    jobId: jobId,
    jobKey: job.job_id,
    fallbackFilename: `${baseName || slugForStorage}.pdf`,
  });

  let uploadResult;
  try {
    uploadResult = await savePrintPdfToSupabase(pdfBuffer, storageDetails.filename, {
      jobId,
      jobKey: job.job_id,
      slug: slugForStorage,
      widthCm: filenameWidthCm ?? undefined,
      heightCm: filenameHeightCm ?? undefined,
      widthCmPrint: finalWidthCm ?? widthBaseCm ?? undefined,
      heightCmPrint: finalHeightCm ?? heightBaseCm ?? undefined,
      material: sanitizedMaterial,
      backgroundColor: normalizedBackgroundColor,
      createdBy: 'finalize-assets',
      private: true,
    });
  } catch (err) {
    logger.error('finalize-assets upload', { diagId, error: err?.message || err, code: err?.code, size: err?.size, limit: err?.limit });
    if (err?.code === 'supabase_object_too_large') {
      return res.status(413).json({ ok: false, diag_id: diagId, message: 'pdf_too_large', limit_bytes: err.limit, size_bytes: err.size });
    }
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'upload_failed' });
  }

  let previewUpload = null;
  try {
    previewUpload = await savePrintPreviewToSupabase(previewBuffer, storageDetails.filename.replace(/\.pdf$/i, '.jpg'), {
      jobId,
      jobKey: job.job_id,
      slug: slugForStorage,
      widthCm: filenameWidthCm ?? undefined,
      heightCm: filenameHeightCm ?? undefined,
      material: sanitizedMaterial,
      createdBy: 'finalize-assets',
      private: true,
    });
  } catch (previewErr) {
    logger.warn('finalize-assets preview_store_warning', { diagId, error: previewErr?.message || previewErr });
  }

  const pdfPath = uploadResult?.path;
  if (!pdfPath) {
    logger.error('finalize-assets upload', { diagId, error: 'missing_pdf_path' });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'upload_failed' });
  }
  const pdfUrl = uploadResult.publicUrl || uploadResult.signedUrl || null;
  const previewPath = (() => {
    if (previewUpload?.path) {
      return previewUpload.path.replace(/^outputs\//i, '');
    }
    return '';
  })();
  let previewUrl = null;
  if (previewPath) {
    const { data: previewPublicData } = supabase.storage.from(OUTPUT_BUCKET).getPublicUrl(previewPath);
    previewUrl = previewPublicData?.publicUrl || null;
  }
  const fileName = uploadResult.fileName || storageDetails.filename;
  const widthForRecord = finalWidthCm ?? widthBaseCm ?? null;
  const heightForRecord = finalHeightCm ?? heightBaseCm ?? null;
  const imageHash = computeImageHash(innerBuffer || printBuffer || pdfBuffer);
  const jobKey = buildPrintsJobKey({
    slug: slugForStorage,
    widthCm: widthForRecord,
    heightCm: heightForRecord,
    material: sanitizedMaterial,
    backgroundColor: normalizedBackgroundColor,
    imageHash,
  });

  try {
    const { error: printsErr } = await supabase
      .from('prints')
      .upsert({
        job_key: jobKey,
        bucket: OUTPUT_BUCKET,
        file_path: pdfPath,
        file_name: fileName,
        slug: slugForStorage,
        width_cm: widthForRecord,
        height_cm: heightForRecord,
        material: sanitizedMaterial,
        bg_color: normalizedBackgroundColor,
        job_id: jobId,
        file_size_bytes: pdfBuffer.length,
        image_hash: imageHash,
        preview_url: previewUrl,
      }, { onConflict: 'job_key', ignoreDuplicates: false });
    if (printsErr) throw printsErr;
  } catch (err) {
    logger.error('finalize-assets prints_upsert', { diagId, error: err?.message || err });
    try {
      res.setHeader('X-Prints-Upsert', 'failed');
    } catch {}
  }

  const updates = {
    status: 'ASSETS_READY',
    print_jpg_url: null,
    pdf_url: pdfUrl,
    preview_url: previewUrl,
  };

  const { error: updateErr } = await supabase.from('jobs').update(updates).eq('job_id', jobId);
  if (updateErr) {
    logger.error('finalize-assets update', { diagId, error: updateErr.message });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'db_update_error' });
  }

  try {
    if (job.id) {
      await supabase.from('job_events').insert({
        job_id: job.id,
        event: 'assets_finalized',
        detail: {
          pdf_url: pdfUrl,
          preview_url: previewUrl,
          pdf_path: pdfPath,
          signed_url_expires_in: uploadResult.expiresIn ?? null,
          ...(composeDebug ? { compose: composeDebug } : {}),
        },
      });
    }
  } catch (err) {
    logger.warn('finalize-assets event', { diagId, error: err?.message || err });
  }

  return res.status(200).json({
    ok: true,
    diag_id: diagId,
    job_id: jobId,
    assets: {
      pdf_path: pdfPath,
      pdf_url: pdfUrl,
      preview_url: previewUrl,
      signed_url_expires_in: uploadResult.expiresIn ?? null,
    },
  });
}
