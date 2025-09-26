import { randomUUID } from 'node:crypto';
import { slugifyName } from '../../_lib/slug.js';
import generatePrintPdf from '../../_lib/generatePrintPdf.js';
import uploadPrintPdf from '../../_lib/uploadPrintPdf.js';

function toObject(input) {
  if (!input) return {};
  if (typeof input === 'object') return input;
  if (typeof input === 'string') {
    try { return JSON.parse(input); } catch { return {}; }
  }
  return {};
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatDimensionSegment(value) {
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return rounded
    .toFixed(1)
    .replace(/\.0$/, '')
    .replace('.', 'p')
    .replace(/[^0-9p]+/gi, '');
}

function sanitizeMaterial(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'material';
  return slugifyName(raw) || 'material';
}

function sanitizeJobId(input) {
  const raw = String(input || '').trim();
  if (!raw) return randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const slug = slugifyName(raw);
  if (slug) return slug;
  return randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 8);
}

function buildFilename({ slug, widthCm, heightCm, material, jobId }) {
  const safeSlug = slugifyName(slug) || 'diseno';
  const widthSegment = formatDimensionSegment(widthCm);
  const heightSegment = formatDimensionSegment(heightCm);
  const size = `${widthSegment}x${heightSegment}`;
  const materialSegment = sanitizeMaterial(material);
  const jobSegment = sanitizeJobId(jobId);
  return `${[safeSlug, size, materialSegment, jobSegment].join('-')}.pdf`;
}

function normalizeColor(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '#ffffff';
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match) return '#ffffff';
  const [, value] = match;
  if (value.length === 3) {
    return `#${value.split('').map((ch) => ch + ch).join('')}`;
  }
  return `#${value}`;
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(value || ''));
  if (!match) return null;
  const [, mime, data] = match;
  if (!mime || !data) return null;
  try {
    const buffer = Buffer.from(data, 'base64');
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

async function resolveImageBuffer(source) {
  const trimmed = String(source || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) {
    return parseDataUrl(trimmed);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed);
    if (!response.ok) {
      const error = new Error(`download_failed_${response.status}`);
      error.status = response.status;
      throw error;
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.length ? buffer : null;
  }
  return null;
}

function extractImageSource(payload) {
  const candidates = [
    payload?.imageUrl,
    payload?.image_url,
    payload?.image,
    payload?.imageBlob,
    payload?.image_blob,
    payload?.dataUrl,
    payload?.data_url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return null;
}

export async function uploadPrintHandler(req, res) {
  const diagId = randomUUID();
  const requestIdHeader = req.headers['x-request-id'];
  const requestId = Array.isArray(requestIdHeader)
    ? requestIdHeader[0]
    : typeof requestIdHeader === 'string'
      ? requestIdHeader
      : undefined;
  res.setHeader('X-Diag-Id', diagId);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diagId, requestId, error: 'method_not_allowed' });
  }

  let payload = toObject(req.body);
  if (!payload || !Object.keys(payload).length) {
    try {
      const raw = await readRawBody(req);
      payload = toObject(raw);
    } catch (err) {
      console.error('pdf_upload_parse_error', { diagId, requestId, message: err?.message || err });
      return res.status(400).json({ ok: false, diagId, requestId, error: 'invalid_body' });
    }
  }

  const jobId = typeof payload.jobId === 'string' ? payload.jobId.trim() : '';
  const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  const material = typeof payload.material === 'string' ? payload.material.trim() : '';
  const backgroundColor = normalizeColor(payload.backgroundColor || payload.background_color);

  const widthCm = parseNumber(payload.largoCm ?? payload.widthCm ?? payload.width_cm);
  const heightCm = parseNumber(payload.anchoCm ?? payload.heightCm ?? payload.height_cm);

  if (!widthCm || widthCm <= 0 || !heightCm || heightCm <= 0) {
    return res.status(400).json({ ok: false, diagId, requestId, error: 'invalid_dimensions' });
  }

  const imageSource = extractImageSource(payload);
  if (!imageSource) {
    return res.status(400).json({ ok: false, diagId, requestId, error: 'missing_image_source' });
  }

  let imageBuffer;
  try {
    imageBuffer = await resolveImageBuffer(imageSource);
  } catch (err) {
    console.error('pdf_image_download_error', {
      diagId,
      requestId,
      message: err?.message || err,
      status: err?.status || err?.statusCode || null,
    });
    return res.status(400).json({ ok: false, diagId, requestId, error: 'image_download_failed' });
  }

  if (!imageBuffer || !imageBuffer.length) {
    return res.status(400).json({ ok: false, diagId, requestId, error: 'empty_image' });
  }

  const filename = buildFilename({
    slug,
    widthCm,
    heightCm,
    material,
    jobId,
  });

  console.info('pdf_generate_start', {
    diagId,
    requestId,
    jobId,
    slug: slug || null,
    material: material || null,
    widthCm,
    heightCm,
  });

  let pdfResult;
  try {
    pdfResult = await generatePrintPdf({
      widthCm,
      heightCm,
      backgroundColor,
      imageBuffer,
    });
  } catch (err) {
    console.error('pdf_generate_error', {
      diagId,
      requestId,
      error: err?.code || err?.message || 'pdf_generate_error',
      message: err?.message || err,
    });
    return res.status(500).json({ ok: false, diagId, requestId, error: 'pdf_generation_failed' });
  }

  console.info('pdf_generate_end', {
    diagId,
    requestId,
    jobId,
    filename,
    size: pdfResult.buffer.length,
    pageWidthCm: pdfResult.info.pageWidthCm,
    pageHeightCm: pdfResult.info.pageHeightCm,
  });

  console.info('pdf_upload_start', {
    diagId,
    requestId,
    jobId,
    filename,
    size: pdfResult.buffer.length,
  });

  let uploadResult;
  try {
    uploadResult = await uploadPrintPdf({
      buffer: pdfResult.buffer,
      filename,
      metadata: {
        jobId: jobId || undefined,
        slug: slug || undefined,
        widthCm,
        heightCm,
        material: material || undefined,
        backgroundColor: pdfResult.info.backgroundColor,
      },
      diagId,
    });
  } catch (err) {
    console.error('pdf_upload_failure', {
      diagId,
      requestId,
      error: err?.code || err?.message || 'pdf_upload_failure',
      message: err?.message || err,
    });
    return res.status(502).json({ ok: false, diagId, requestId, error: 'pdf_upload_failed' });
  }

  console.info('pdf_upload_end', {
    diagId,
    requestId,
    jobId,
    filename,
    bucket: uploadResult.bucket,
    path: uploadResult.path,
  });

  return res.status(200).json({
    ok: true,
    diagId,
    requestId,
    bucket: uploadResult.bucket,
    path: uploadResult.path,
    publicUrl: uploadResult.publicUrl,
    signedUrl: uploadResult.signedUrl,
    expiresIn: uploadResult.expiresIn,
    filename,
  });
}

export default uploadPrintHandler;
