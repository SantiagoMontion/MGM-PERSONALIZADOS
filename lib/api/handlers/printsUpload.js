import { createHash, randomUUID } from 'node:crypto';
import { slugifyName } from '../../_lib/slug.js';
import generatePrintPdf, { validatePrintPdf } from '../../_lib/generatePrintPdf.js';
import uploadPrintPdf, { SIGNED_URL_TTL_SECONDS as UPLOAD_SIGNED_URL_TTL_SECONDS } from '../../_lib/uploadPrintPdf.js';
import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';
import { buildPrintStorageDetails } from '../../_lib/printNaming.js';
import logger from '../../_lib/logger.js';

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

function computeImageHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const MAX_GENERATE_ATTEMPTS = 2;
const VALIDATION_TOLERANCE_MM = 1;
const BLEED_MARGIN_CM = 2;
const OUTPUT_BUCKET = 'outputs';
const PRINTS_TABLE = 'prints';

function formatNumberForKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/0$/, '');
}

function buildJobKey({ slug, widthCm, heightCm, material, backgroundColor, imageHash }) {
  const widthSegment = formatNumberForKey(widthCm);
  const heightSegment = formatNumberForKey(heightCm);
  return [slug, widthSegment, heightSegment, material, backgroundColor, imageHash].join('|');
}

function safeSlug(input) {
  return slugifyName(input) || 'diseno';
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function normalizeImageMime(input) {
  if (!input) return null;
  const raw = String(input).toLowerCase();
  if (raw.includes('png')) return 'image/png';
  if (raw.includes('jpeg') || raw.includes('jpg')) return 'image/jpeg';
  return null;
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(value || ''));
  if (!match) return null;
  const [, mime, data] = match;
  if (!mime || !data) return null;
  try {
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length) return null;
    return { buffer, mime: normalizeImageMime(mime), source: 'dataurl' };
  } catch {
    return null;
  }
}

async function resolveImageBuffer({ value, type }) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  if (type === 'dataurl' || trimmed.startsWith('data:')) {
    const parsed = parseDataUrl(trimmed);
    return parsed;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const response = await fetch(trimmed);
  if (!response.ok) {
    const error = new Error(`download_failed_${response.status}`);
    error.status = response.status;
    throw error;
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) return null;
  const headerMime = normalizeImageMime(response.headers?.get?.('content-type') || null);
  return { buffer, mime: headerMime, source: type || 'original' };
}

const ORIGINAL_SOURCE_KEYS = [
  'originalUrl',
  'original_url',
  'fileOriginalUrl',
  'file_original_url',
  'canonical',
  'canonicalUrl',
  'canonical_url',
];
const DATA_URL_KEYS = ['dataUrl', 'data_url', 'mockupDataUrl', 'mockup_data_url'];
const MAX_IMAGE_SOURCE_SEARCH_DEPTH = 6;

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function isDataUrl(value) {
  return /^data:/i.test(value);
}

function searchImageSource(input, desiredType, depth = 0, path = '', visited = new Set()) {
  if (depth > MAX_IMAGE_SOURCE_SEARCH_DEPTH || input == null) {
    return null;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (desiredType === 'original' && isHttpUrl(trimmed)) {
      return { value: trimmed, type: 'original', key: path || 'payload' };
    }
    if (desiredType === 'dataurl' && isDataUrl(trimmed)) {
      return { value: trimmed, type: 'dataurl', key: path || 'payload' };
    }
    return null;
  }

  if (typeof input !== 'object') {
    return null;
  }

  if (visited.has(input)) {
    return null;
  }
  visited.add(input);

  if (Array.isArray(input)) {
    for (let index = 0; index < input.length; index += 1) {
      const nextPath = path ? `${path}[${index}]` : `[${index}]`;
      const found = searchImageSource(input[index], desiredType, depth + 1, nextPath, visited);
      if (found) {
        return found;
      }
    }
    return null;
  }

  const keysToCheck = desiredType === 'original' ? ORIGINAL_SOURCE_KEYS : DATA_URL_KEYS;
  for (const key of keysToCheck) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const candidate = input[key];
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (desiredType === 'original' && isHttpUrl(trimmed)) {
      const resolvedKey = path ? `${path}.${key}` : key;
      return { value: trimmed, type: 'original', key: resolvedKey };
    }
    if (desiredType === 'dataurl' && isDataUrl(trimmed)) {
      const resolvedKey = path ? `${path}.${key}` : key;
      return { value: trimmed, type: 'dataurl', key: resolvedKey };
    }
  }

  for (const [key, child] of Object.entries(input)) {
    const nextPath = path ? `${path}.${key}` : key;
    const found = searchImageSource(child, desiredType, depth + 1, nextPath, visited);
    if (found) {
      return found;
    }
  }

  return null;
}

function extractImageSource(payload) {
  const original = searchImageSource(payload, 'original');
  if (original) {
    return original;
  }
  return searchImageSource(payload, 'dataurl');
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
    return res.status(405).json({ ok: false, diagId, requestId, reason: 'method_not_allowed' });
  }

  let payload = toObject(req.body);
  if (!payload || !Object.keys(payload).length) {
    try {
      const raw = await readRawBody(req);
      payload = toObject(raw);
    } catch (err) {
      logger.error('pdf_upload_parse_error', { diagId, requestId, message: err?.message || err });
      return res.status(400).json({ ok: false, diagId, requestId, reason: 'invalid_body' });
    }
  }

  const jobId = typeof payload.jobId === 'string' ? payload.jobId.trim() : '';
  const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  const material = typeof payload.material === 'string' ? payload.material.trim() : '';
  const backgroundColor = normalizeColor(payload.backgroundColor || payload.background_color);

  const widthCm = parseNumber(payload.largoCm ?? payload.widthCm ?? payload.width_cm);
  const heightCm = parseNumber(payload.anchoCm ?? payload.heightCm ?? payload.height_cm);

  if (!widthCm || widthCm <= 0 || !heightCm || heightCm <= 0) {
    return res.status(400).json({ ok: false, diagId, requestId, reason: 'invalid_dimensions' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    logger.error('prints_supabase_init_error', { diagId, requestId, message: err?.message || err });
    return res.status(500).json({ ok: false, diagId, requestId, reason: 'supabase_init_failed' });
  }

  let jobRecord = null;
  if (jobId) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('file_original_url')
        .eq('job_id', jobId)
        .maybeSingle();
      if (error) throw error;
      jobRecord = data || null;
    } catch (err) {
      logger.warn('prints_job_lookup_warning', {
        diagId,
        requestId,
        jobId,
        message: err?.message || err,
      });
    }
  }

  if (jobRecord?.file_original_url) {
    payload = {
      ...payload,
      originalUrl: jobRecord.file_original_url,
      original_url: jobRecord.file_original_url,
      fileOriginalUrl: jobRecord.file_original_url,
      file_original_url: jobRecord.file_original_url,
    };
  }

  const imageSource = extractImageSource(payload);
  if (!imageSource) {
    return res.status(400).json({ ok: false, diagId, requestId, reason: 'missing_image_source' });
  }

  let imagePayload;
  try {
    imagePayload = await resolveImageBuffer(imageSource);
  } catch (err) {
    logger.error('pdf_image_download_error', {
      diagId,
      requestId,
      message: err?.message || err,
      status: err?.status || err?.statusCode || null,
    });
    return res.status(400).json({ ok: false, diagId, requestId, reason: 'image_download_failed' });
  }

  if (!imagePayload?.buffer || !imagePayload.buffer.length) {
    return res.status(400).json({ ok: false, diagId, requestId, reason: 'empty_image' });
  }

  const imageBuffer = imagePayload.buffer;
  const imageMime = normalizeImageMime(imagePayload.mime) || null;
  const imageSourceType = imagePayload.source === 'dataurl' ? 'dataurl' : 'original';

  const safeSlugValue = safeSlug(slug);
  const safeMaterial = sanitizeMaterial(material);
  const safeJobId = sanitizeJobId(jobId);
  const imageHash = computeImageHash(imageBuffer);
  const jobKey = buildJobKey({
    slug: safeSlugValue,
    widthCm,
    heightCm,
    material: safeMaterial,
    backgroundColor,
    imageHash,
  });

  const storageDetails = buildPrintStorageDetails({
    slug: safeSlugValue,
    widthCm,
    heightCm,
    material: safeMaterial,
    jobId: safeJobId,
    jobKey,
    fallbackFilename: typeof payload?.filename === 'string' ? payload.filename : undefined,
  });
  const filename = storageDetails.filename;

  res.setHeader('X-Job-Key', jobKey);

  logger.debug('prints_image_source_selected', {
    diagId,
    requestId,
    jobId: safeJobId,
    jobKey,
    source: imageSourceType,
    mime: imageMime,
    hasOriginal: imageSourceType === 'original',
    sourceKey: imageSource.key,
  });

  const storage = supabase.storage.from(OUTPUT_BUCKET);

  let existingRecord = null;
  try {
    const { data, error } = await supabase
      .from(PRINTS_TABLE)
      .select('*')
      .eq('job_key', jobKey)
      .maybeSingle();
    if (error) throw error;
    existingRecord = data || null;
  } catch (err) {
    logger.error('prints_lookup_error', {
      diagId,
      requestId,
      jobKey,
      message: err?.message || err,
      code: err?.code || null,
    });
    return res.status(502).json({ ok: false, diagId, requestId, reason: 'db_lookup_failed' });
  }

  if (existingRecord?.file_path) {
    try {
      const { data: signedData, error: signedError } = await storage.createSignedUrl(
        existingRecord.file_path,
        UPLOAD_SIGNED_URL_TTL_SECONDS,
        { download: existingRecord.file_name || filename },
      );
      if (!signedError && signedData?.signedUrl) {
        logger.debug('prints_idempotent_hit', {
          diagId,
          requestId,
          jobKey,
          path: existingRecord.file_path,
          sizeBytes: existingRecord.file_size_bytes || null,
        });
        return res.status(200).json({
          ok: true,
          diagId,
          requestId,
          jobKey,
          bucket: existingRecord.bucket || OUTPUT_BUCKET,
          path: existingRecord.file_path,
          fileName: existingRecord.file_name || filename,
          sizeBytes: existingRecord.file_size_bytes || null,
          signedUrl: signedData.signedUrl,
          expiresIn: UPLOAD_SIGNED_URL_TTL_SECONDS,
        });
      }
      if (signedError) {
        logger.error('prints_idempotent_signed_url_error', {
          diagId,
          requestId,
          jobKey,
          path: existingRecord.file_path,
          message: signedError?.message || 'signed_url_failed',
          status: signedError?.status || signedError?.statusCode || null,
        });
      }
    } catch (err) {
      logger.error('prints_idempotent_signed_url_error', {
        diagId,
        requestId,
        jobKey,
        path: existingRecord.file_path,
        message: err?.message || err,
      });
    }
  }

  const expectedPageWidthCm = widthCm + BLEED_MARGIN_CM * 2;
  const expectedPageHeightCm = heightCm + BLEED_MARGIN_CM * 2;

  let pdfResult = null;
  let validationResult = null;

  for (let attempt = 1; attempt <= MAX_GENERATE_ATTEMPTS; attempt += 1) {
    logger.debug('pdf_generate_start', {
      diagId,
      requestId,
      jobId: safeJobId,
      jobKey,
      slug: safeSlugValue,
      material: safeMaterial,
      widthCm,
      heightCm,
      backgroundColor,
      imageHash,
      imageSource: imageSourceType,
      imageMime,
      attempt,
      pageCm: { widthCm: expectedPageWidthCm, heightCm: expectedPageHeightCm },
      artCm: { widthCm, heightCm },
      marginsCm: {
        left: BLEED_MARGIN_CM,
        right: BLEED_MARGIN_CM,
        top: BLEED_MARGIN_CM,
        bottom: BLEED_MARGIN_CM,
      },
    });

    try {
      pdfResult = await generatePrintPdf({
        widthCm,
        heightCm,
        backgroundColor,
        imageBuffer,
        diagId,
        imageMime,
        source: imageSourceType,
      });
    } catch (err) {
      logger.error('pdf_generate_error', {
        diagId,
        requestId,
        jobKey,
        attempt,
        imageSource: imageSourceType,
        imageMime,
        error: err?.code || err?.message || 'pdf_generate_error',
        message: err?.message || err,
      });
      if (err?.code === 'pdf_embed_mismatch') {
        return res.status(500).json({ ok: false, diagId, requestId, reason: 'pdf_embed_mismatch' });
      }
      if (attempt >= MAX_GENERATE_ATTEMPTS) {
        return res.status(500).json({ ok: false, diagId, requestId, reason: 'pdf_generate_failed' });
      }
      continue;
    }

    logger.debug('pdf_generate_end', {
      diagId,
      requestId,
      jobId: safeJobId,
      jobKey,
      filename,
      attempt,
      sizeBytes: pdfResult.buffer.length,
      imageSource: imageSourceType,
      imageMime,
      pageCm: {
        widthCm: pdfResult.info.pageWidthCm,
        heightCm: pdfResult.info.pageHeightCm,
      },
      artCm: {
        widthCm: pdfResult.info.area.widthCm,
        heightCm: pdfResult.info.area.heightCm,
      },
      marginCm: pdfResult.info.marginCm,
      areaWidthPx: pdfResult.info.area.widthPx,
      areaHeightPx: pdfResult.info.area.heightPx,
      artworkWidthPx: pdfResult.info.artwork.widthPx,
      artworkHeightPx: pdfResult.info.artwork.heightPx,
      artworkOffsetLeftPx: pdfResult.info.artwork.offsetLeftPx,
      artworkOffsetTopPx: pdfResult.info.artwork.offsetTopPx,
    });

    try {
      validationResult = await validatePrintPdf({
        buffer: pdfResult.buffer,
        expectedPageWidthCm,
        expectedPageHeightCm,
        expectedAreaWidthCm: widthCm,
        expectedAreaHeightCm: heightCm,
        marginCm: pdfResult.info.marginCm,
        toleranceMm: VALIDATION_TOLERANCE_MM,
      });
    } catch (err) {
      logger.error('pdf_validate_fail', {
        diagId,
        requestId,
        jobKey,
        attempt,
        filename,
        error: err?.code || err?.message || 'pdf_validate_error',
        message: err?.message || err,
      });
      pdfResult = null;
      validationResult = null;
      if (attempt >= MAX_GENERATE_ATTEMPTS) {
        return res.status(500).json({ ok: false, diagId, requestId, reason: 'pdf_validate_failed' });
      }
      continue;
    }

    if (!validationResult.ok) {
      logger.error('pdf_validate_fail', {
        diagId,
        requestId,
        jobKey,
        attempt,
        filename,
        measured: validationResult.measured,
        expected: validationResult.expected,
        deltasMm: validationResult.deltasMm,
        toleranceMm: validationResult.toleranceMm,
      });
      pdfResult = null;
      validationResult = null;
      if (attempt >= MAX_GENERATE_ATTEMPTS) {
        return res.status(500).json({ ok: false, diagId, requestId, reason: 'pdf_validate_failed' });
      }
      continue;
    }

    logger.debug('pdf_validate_ok', {
      diagId,
      requestId,
      jobKey,
      attempt,
      filename,
      measured: validationResult.measured,
      expected: validationResult.expected,
      deltasMm: validationResult.deltasMm,
      toleranceMm: validationResult.toleranceMm,
    });

    break;
  }

  if (!pdfResult || !validationResult?.ok) {
    return res.status(500).json({ ok: false, diagId, requestId, reason: 'pdf_validate_failed' });
  }

  const sizeBytes = pdfResult.buffer.length;

  const plannedPath = storageDetails.path;

  logger.debug('pdf_upload_start', {
    diagId,
    requestId,
    jobId: safeJobId,
    jobKey,
    filename,
    path: plannedPath,
    sizeBytes,
  });

  let uploadResult;
  try {
    uploadResult = await uploadPrintPdf({
      buffer: pdfResult.buffer,
      filename,
      metadata: {
        jobId: safeJobId,
        jobKey,
        slug: safeSlugValue,
        widthCm,
        heightCm,
        material: safeMaterial,
        backgroundColor: pdfResult.info.backgroundColor,
        imageHash,
      },
      diagId,
    });
  } catch (err) {
    const reason = err?.code === 'pdf_too_large' ? 'pdf_too_large' : 'pdf_upload_failed';
    const statusCode = reason === 'pdf_too_large' ? 413 : 502;
    logger.error('pdf_upload_failure', {
      diagId,
      requestId,
      jobKey,
      filename,
      sizeBytes,
      error: err?.code || err?.message || 'pdf_upload_failure',
      message: err?.message || err,
    });
    return res.status(statusCode).json({ ok: false, diagId, requestId, reason });
  }

  const storedFileName = uploadResult.fileName || filename;

  logger.debug('pdf_upload_ok', {
    diagId,
    requestId,
    jobId: safeJobId,
    jobKey,
    filename: storedFileName,
    bucket: uploadResult.bucket,
    path: uploadResult.path,
    sizeBytes,
    contentType: 'application/pdf',
  });

  const recordPayload = {
    job_key: jobKey,
    bucket: uploadResult.bucket,
    file_path: uploadResult.path,
    file_name: storedFileName,
    slug: safeSlugValue,
    width_cm: widthCm,
    height_cm: heightCm,
    material: safeMaterial,
    bg_color: backgroundColor,
    job_id: safeJobId,
    file_size_bytes: sizeBytes,
    image_hash: imageHash,
  };

  let upsertedRecord = null;
  try {
    const { data, error } = await supabase
      .from(PRINTS_TABLE)
      .upsert(recordPayload, { onConflict: 'job_key', ignoreDuplicates: false })
      .select()
      .maybeSingle();
    if (error) throw error;
    upsertedRecord = data || null;
  } catch (err) {
    logger.error('prints_upsert_error', {
      diagId,
      requestId,
      jobKey,
      path: uploadResult.path,
      message: err?.message || err,
      code: err?.code || null,
    });
    return res.status(502).json({ ok: false, diagId, requestId, reason: 'db_upsert_failed' });
  }

  logger.debug('prints_upsert_ok', {
    diagId,
    requestId,
    jobKey,
    path: uploadResult.path,
    id: upsertedRecord?.id || null,
  });

  return res.status(200).json({
    ok: true,
    diagId,
    requestId,
    jobKey,
    bucket: uploadResult.bucket,
    path: uploadResult.path,
    fileName: storedFileName,
    sizeBytes,
    signedUrl: uploadResult.signedUrl,
    publicUrl: uploadResult.publicUrl || null,
    expiresIn: uploadResult.expiresIn ?? UPLOAD_SIGNED_URL_TTL_SECONDS,
  });
}

export default uploadPrintHandler;
