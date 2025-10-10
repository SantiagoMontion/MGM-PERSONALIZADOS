import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import logger from '../../lib/_lib/logger.js';

const ALLOWED_BUCKETS = new Set(['outputs', 'preview', 'uploads']);
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_EXPIRES = 600;

function guessExtension(contentType) {
  if (typeof contentType !== 'string') return '';
  const lower = contentType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('pdf')) return 'pdf';
  if (lower.includes('webp')) return 'webp';
  return '';
}

function buildObjectPath(path, contentType) {
  const trimmed = typeof path === 'string' ? path.trim().replace(/^\/+/, '') : '';
  if (trimmed) return trimmed;
  const ext = guessExtension(contentType);
  const suffix = ext ? `.${ext}` : '';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${suffix}`;
}

function buildStorageUrl(base, bucket, key, isPublic) {
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  const visibility = isPublic ? 'public/' : '';
  return `${normalizedBase}/storage/v1/object/${visibility}${bucket}/${key}`;
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
    res.status(405).json({ ok: false, error: 'method_not_allowed', diagId });
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
      res.status(400).json({ ok: false, error: 'content_type_required', diagId });
      return;
    }

    const expiresInRaw = Number.isFinite(Number(body.expiresIn)) && Number(body.expiresIn) > 0
      ? Math.min(Math.round(Number(body.expiresIn)), 60 * 60 * 24)
      : DEFAULT_EXPIRES;

    const requestedPath = typeof body.path === 'string'
      ? body.path
      : typeof body.objectKey === 'string'
        ? body.objectKey
        : '';
    objectKey = buildObjectPath(requestedPath, contentType);
    const wantsUpsert = typeof body.upsert === 'boolean'
      ? body.upsert
      : requestedBucket === 'preview' || requestedBucket === 'outputs';

    const supabase = getSupabaseAdmin();

    logger.debug?.('[storage:sign:req]', {
      diagId,
      bucket: requestedBucket,
      key: objectKey,
      upsert: wantsUpsert,
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

    const signInBucket = async (bucketName, upsertFlag) => {
      const ensureError = await ensureBucketExists(bucketName);
      if (ensureError) {
        return { error: ensureError };
      }
      const { data, error } = await supabase
        .storage
        .from(bucketName)
        .createSignedUploadUrl(objectKey, expiresInRaw, { upsert: upsertFlag, contentType });
      if (error || !data?.signedUrl) {
        return { error: error || new Error('missing_signed_url') };
      }
      const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(objectKey);
      return { data, publicData };
    };

    let bucket = requestedBucket;
    let signResult = await signInBucket(bucket, wantsUpsert);
    if (signResult.error && bucket === 'preview' && !wantsUpsert) {
      const retryUpsert = true;
      signResult = await signInBucket(bucket, retryUpsert);
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
      signResult = await signInBucket(bucket, true);
    }

    if (signResult.error || !signResult?.data?.signedUrl) {
      const reason = signResult.error?.message || signResult.error || 'missing_signed_url';
      logger.error?.('[storage:sign:error]', {
        diagId,
        bucket,
        objectKey,
        error: reason,
      });
      res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
      res.status(500).json({
        ok: false,
        error: 'sign_failed',
        diagId,
        detail: reason,
      });
      return;
    }

    const signedData = signResult.data;
    const publicData = signResult.publicData;
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const resolvedPublicUrl = (() => {
      if (bucket === 'uploads') return null;
      if (publicData?.publicUrl) return publicData.publicUrl;
      if (!supabaseUrl || !objectKey) return null;
      return buildStorageUrl(supabaseUrl, bucket, objectKey, bucket !== 'uploads');
    })();

    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      ok: true,
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
    logger.debug?.('[storage:sign:ok]', { diagId, bucket, key: objectKey });
  } catch (err) {
    const message = err?.message || String(err);
    logger.error?.('[storage:sign:error]', {
      diagId,
      bucket: requestedBucket,
      objectKey,
      error: message,
    });
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.status(500).json({
      ok: false,
      error: 'sign_failed',
      diagId,
      detail: message,
    });
  }
}
