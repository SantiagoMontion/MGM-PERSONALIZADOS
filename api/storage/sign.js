import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import logger from '../../lib/_lib/logger.js';

const ALLOWED_BUCKETS = new Set(['outputs', 'preview', 'uploads']);
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_EXPIRES = 600;

function sendJson(res, status, payload) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(payload);
}

function guessExtension(contentType) {
  if (typeof contentType !== 'string') return '';
  const lower = contentType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('pdf')) return 'pdf';
  if (lower.includes('webp')) return 'webp';
  return '';
}

function buildStorageUrl(base, bucket, key, isPublic) {
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  const visibility = isPublic ? 'public/' : '';
  return `${normalizedBase}/storage/v1/object/${visibility}${bucket}/${key}`;
}

function sanitizeTitle(value) {
  const base = (value ?? 'Design').toString();
  const normalized = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || 'Design';
}

function normalizeMaterialLabel(value) {
  const text = (value ?? '').toString().toLowerCase();
  if (text.includes('glass')) return 'Glasspad';
  if (text.includes('pro')) return 'PRO';
  if (text.includes('classic')) return 'Classic';
  return (value ?? '').toString().trim() || 'Classic';
}

function extractDimension(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
}

function extractHash(value) {
  const raw = (value ?? '').toString().trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 8);
  return cleaned;
}

function buildGeneratedObjectKey(body, contentType) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const folder = `mockups-${year}-${month}`;
  const title = sanitizeTitle(body?.title || body?.designName || body?.name || 'Design');
  const material = sanitizeTitle(normalizeMaterialLabel(body?.material));
  const width = extractDimension(body?.widthCm);
  const height = extractDimension(body?.heightCm);
  const dims = width && height ? `${width}x${height}` : null;
  const hash = extractHash(body?.designHash) || Math.random().toString(36).slice(2, 10);
  const ext = (() => {
    const guessed = guessExtension(contentType);
    if (!guessed) return '.png';
    return guessed.startsWith('.') ? guessed : `.${guessed}`;
  })();
  const parts = [title];
  if (dims) parts.push(dims);
  if (material) parts.push(material);
  if (hash) parts.push(hash);
  const filename = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || 'Design';
  return `${folder}/${filename}${ext}`;
}

function resolveObjectKey(body, contentType) {
  const explicit = typeof body?.objectKey === 'string' ? body.objectKey.trim() : '';
  if (explicit) {
    return explicit.replace(/^\/+/, '');
  }
  const legacyPath = typeof body?.path === 'string' ? body.path.trim() : '';
  if (legacyPath) {
    return legacyPath.replace(/^\/+/, '');
  }
  return buildGeneratedObjectKey(body, contentType);
}

function isAlreadyExistsError(error) {
  if (!error) return false;
  const message = typeof error.message === 'string' ? error.message : String(error);
  return /already exists/i.test(message);
}

export default async function handler(req, res) {
  const diagId = randomUUID();
  const decision = ensureCors(req, res);
  if (!decision?.allowed || !decision?.allowedOrigin) {
    respondCorsDenied(req, res, decision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    sendJson(res, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  let requestedBucket = DEFAULT_BUCKET;
  let objectKey = '';

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== 'object') {
      body = {};
    }

    const bucketRaw = typeof body.bucket === 'string' ? body.bucket.trim() : DEFAULT_BUCKET;
    requestedBucket = ALLOWED_BUCKETS.has(bucketRaw) ? bucketRaw : DEFAULT_BUCKET;

    const contentType = typeof body.contentType === 'string' && body.contentType.trim()
      ? body.contentType.trim()
      : '';
    if (!contentType) {
      sendJson(res, 400, { ok: false, error: 'content_type_required', diagId });
      return;
    }

    const expiresInRaw = Number.isFinite(Number(body.expiresIn)) && Number(body.expiresIn) > 0
      ? Math.min(Math.round(Number(body.expiresIn)), 60 * 60 * 24)
      : DEFAULT_EXPIRES;

    objectKey = resolveObjectKey(body, contentType);

    const supabase = getSupabaseAdmin();
    const supabaseUrl = process.env.SUPABASE_URL || '';

    logger.debug?.('[storage:sign:req]', {
      diagId,
      bucket: requestedBucket,
      key: objectKey,
      upsert: true,
      contentType,
    });

    const ensureBucketExists = async (bucketName) => {
      try {
        const { data: bucketInfo, error: getError } = await supabase.storage.getBucket(bucketName);
        if (bucketInfo) {
          return null;
        }
        if (getError && getError.message && /not found/i.test(getError.message)) {
          // proceed to create
        } else if (getError && !bucketInfo) {
          // Unexpected error while fetching bucket metadata
          logger.warn?.('[sign] get_bucket_error', { bucket: bucketName, error: getError.message });
        }
        const { error: createError } = await supabase.storage.createBucket(bucketName, {
          public: bucketName !== 'uploads',
        });
        if (createError && createError.message && /already exists/i.test(createError.message)) {
          return null;
        }
        if (createError) {
          return createError;
        }
        return null;
      } catch (error) {
        if (error?.message && /already exists/i.test(error.message)) {
          return null;
        }
        return error;
      }
    };

    const computePublicUrl = (bucketName) => {
      if (!supabaseUrl || !objectKey) return null;
      return buildStorageUrl(supabaseUrl, bucketName, objectKey, true);
    };

    const signInBucket = async (bucketName) => {
      const ensureError = await ensureBucketExists(bucketName);
      if (ensureError) {
        if (isAlreadyExistsError(ensureError)) {
          return {
            skip: true,
            bucket: bucketName,
            publicUrl: computePublicUrl(bucketName),
          };
        }
        return { error: ensureError, bucket: bucketName };
      }
      const { data, error } = await supabase
        .storage
        .from(bucketName)
        .createSignedUploadUrl(objectKey, expiresInRaw, { upsert: true, contentType });
      if (error || !data?.signedUrl) {
        if (isAlreadyExistsError(error)) {
          const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(objectKey);
          return {
            skip: true,
            bucket: bucketName,
            publicUrl: publicData?.publicUrl || computePublicUrl(bucketName),
          };
        }
        return { error: error || new Error('missing_signed_url'), bucket: bucketName };
      }
      const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(objectKey);
      return {
        bucket: bucketName,
        data,
        publicUrl: publicData?.publicUrl || computePublicUrl(bucketName),
      };
    };

    let bucket = requestedBucket;
    let signResult = await signInBucket(bucket);

    if (signResult.skip) {
      const publicUrl = signResult.publicUrl || computePublicUrl(bucket);
      sendJson(res, 200, {
        ok: true,
        skipUpload: true,
        bucket,
        objectKey,
        publicUrl,
        diagId,
        requestedBucket,
      });
      logger.debug?.('[storage:sign:ok]', { diagId, bucket, key: objectKey, skip: true });
      return;
    }

    if (signResult.error && bucket === 'preview') {
      const reason = signResult.error?.message || signResult.error || 'missing_signed_url';
      logger.warn?.('[sign] retry_default_bucket', {
        diagId,
        requestedBucket,
        bucket,
        objectKey,
        error: reason,
      });
      bucket = DEFAULT_BUCKET;
      signResult = await signInBucket(bucket);
      if (signResult.skip) {
        const publicUrl = signResult.publicUrl || computePublicUrl(bucket);
        sendJson(res, 200, {
          ok: true,
          skipUpload: true,
          bucket,
          objectKey,
          publicUrl,
          diagId,
          requestedBucket,
        });
        logger.debug?.('[storage:sign:ok]', { diagId, bucket, key: objectKey, skip: true });
        return;
      }
    }

    if (signResult.error || !signResult?.data?.signedUrl) {
      const reason = signResult.error?.message || signResult.error || 'missing_signed_url';
      logger.error?.('[storage:sign:error]', {
        diagId,
        bucket,
        objectKey,
        error: reason,
      });
      sendJson(res, 500, {
        ok: false,
        error: 'sign_failed',
        diagId,
        detail: reason,
      });
      return;
    }

    const signedData = signResult.data;
    const resolvedPublicUrl = signResult.publicUrl || computePublicUrl(bucket);

    sendJson(res, 200, {
      ok: true,
      skipUpload: false,
      bucket,
      path: objectKey,
      objectKey,
      uploadUrl: signedData?.signedUrl || null,
      publicUrl: resolvedPublicUrl,
      expiresIn: expiresInRaw,
      token: signedData?.token || null,
      signedUrl: signedData?.signedUrl || null,
      diagId,
      requestedBucket,
      method: 'POST',
      requiredHeaders: {
        'content-type': contentType || 'image/jpeg',
        'x-upsert': 'true',
      },
      upsert: true,
    });
    logger.debug?.('[storage:sign:ok]', { diagId, bucket, key: objectKey, skip: false });
  } catch (err) {
    const message = err?.message || String(err);
    logger.error?.('[storage:sign:error]', {
      diagId,
      bucket: requestedBucket,
      objectKey,
      error: message,
    });
    sendJson(res, 500, {
      ok: false,
      error: 'sign_failed',
      diagId,
      detail: message,
    });
  }
}
