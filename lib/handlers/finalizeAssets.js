import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import { slugifyName, sizeLabel } from '../_lib/slug.js';
import composeImage from '../_lib/composeImage.js';
import savePrintPdfToSupabase from '../_lib/savePrintPdfToSupabase.js';
import { buildPrintStorageDetails } from '../_lib/printNaming.js';

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

export default async function finalizeAssets(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);

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
      console.error('finalize-assets read_body', { diagId, error: err?.message || err });
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
    console.error('finalize-assets env', { diagId, error: err?.message || err });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'missing_env' });
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id,job_id,design_name,material,w_cm,h_cm,bleed_mm,file_original_url')
    .eq('job_id', jobId)
    .maybeSingle();

  if (jobErr) {
    console.error('finalize-assets select', { diagId, error: jobErr.message });
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

  const candidateUrls = [
    typeof payload.design_url === 'string' ? payload.design_url : '',
    typeof payload.designUrl === 'string' ? payload.designUrl : '',
    renderDescriptor?.design_url ? String(renderDescriptor.design_url) : '',
    job.file_original_url || '',
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
    console.error('finalize-assets fetch', { diagId, error: err?.message || err });
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
      console.warn('finalize-assets compose', { diagId, error: err?.message || err });
      printBuffer = sourceBuffer;
      innerBuffer = null;
    }
  }
  if (!innerBuffer) innerBuffer = printBuffer;

  let pdfBuffer;
  try {
    pdfBuffer = await sharp(printBuffer)
      .flatten({ background: '#ffffff' })
      .withMetadata({ density: 300 })
      .toFormat('pdf')
      .toBuffer();
  } catch (err) {
    console.error('finalize-assets render', { diagId, error: err?.message || err });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'render_failed' });
  }

  const baseName = buildBaseName(job, payload, renderDescriptor);
  const storageDetails = buildPrintStorageDetails({
    slug: slugForStorage,
    widthCm: widthCmValue ?? job?.w_cm,
    heightCm: heightCmValue ?? job?.h_cm,
    material: materialValue,
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
      widthCm: widthCmValue ?? job?.w_cm,
      heightCm: heightCmValue ?? job?.h_cm,
      material: materialValue,
      backgroundColor,
      createdBy: 'finalize-assets',
      private: true,
    });
  } catch (err) {
    console.error('finalize-assets upload', { diagId, error: err?.message || err });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'upload_failed' });
  }

  const pdfPath = uploadResult?.path;
  if (!pdfPath) {
    console.error('finalize-assets upload', { diagId, error: 'missing_pdf_path' });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'upload_failed' });
  }
  const pdfUrl = uploadResult.publicUrl || uploadResult.signedUrl || null;
  const previewPath = pdfPath.startsWith('outputs/') ? pdfPath : `outputs/${pdfPath}`;
  const previewUrl = `/api/prints/preview?path=${encodeURIComponent(previewPath)}`;

  const updates = {
    status: 'ASSETS_READY',
    print_jpg_url: null,
    pdf_url: pdfUrl,
    preview_url: previewUrl,
  };

  const { error: updateErr } = await supabase.from('jobs').update(updates).eq('job_id', jobId);
  if (updateErr) {
    console.error('finalize-assets update', { diagId, error: updateErr.message });
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
    console.warn('finalize-assets event', { diagId, error: err?.message || err });
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

