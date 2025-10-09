import logger from './logger.js';
import getSupabaseAdmin from './supabaseAdmin.js';
import { makeErr } from './errors.js';

export const DEFAULT_UPLOADS_BUCKET = 'uploads';

function safeTrim(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
}

function normalizeBucket(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return DEFAULT_UPLOADS_BUCKET;
  const [bucket] = trimmed.split('/').filter(Boolean);
  if (!bucket) return DEFAULT_UPLOADS_BUCKET;
  return bucket;
}

export function resolveUploadsObjectKey(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value) return '';

  if (/^https?:\/\//i.test(value)) {
    const match = /storage\/v1\/object\/(?:public\/)?uploads\/(.+)$/i.exec(value);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    return '';
  }

  value = value.replace(/^storage\/v1\/object\//i, '');
  value = value.replace(/^public\//i, '');
  value = value.replace(/^uploads\//i, '');
  value = value.replace(/^\/+/g, '');
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeObjectKey(value) {
  const resolved = resolveUploadsObjectKey(value);
  const sanitized = safeTrim(resolved).replace(/^\/+/g, '');
  return sanitized || '';
}

export function normalizeOriginalReference({
  originalObjectKey,
  originalBucket,
  originalUrl,
} = {}) {
  const url = safeTrim(originalUrl);
  const bucketRaw = safeTrim(originalBucket);
  const bucketParts = bucketRaw ? bucketRaw.split('/').filter(Boolean) : [];
  let bucket = bucketParts.length ? normalizeBucket(bucketParts[0]) : normalizeBucket(bucketRaw);
  let key = normalizeObjectKey(originalObjectKey);

  if (bucketParts.length > 1) {
    const prefix = bucketParts.slice(1).join('/');
    const combined = [prefix, key].filter(Boolean).join('/');
    key = normalizeObjectKey(combined || prefix);
  }

  if (!key) {
    key = normalizeObjectKey(resolveUploadsObjectKey(url));
  }

  if (!bucket && key) {
    bucket = DEFAULT_UPLOADS_BUCKET;
  }

  return {
    originalObjectKey: key || '',
    originalBucket: bucket || '',
    originalUrl: url || '',
  };
}

async function toBuffer(data) {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (typeof data.arrayBuffer === 'function') {
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data);
  return Buffer.alloc(0);
}

async function downloadFromSupabase({ supabase, bucket, path, rid, diagId }) {
  const storage = supabase.storage.from(bucket);
  const { data, error } = await storage.download(path);
  if (error || !data) {
    logger.warn('original_download_failed', {
      diagId: diagId || null,
      rid: rid || null,
      bucket,
      path,
      status: error?.status || error?.statusCode || null,
      message: error?.message || null,
    });
    return null;
  }
  const buffer = await toBuffer(data);
  if (!buffer.length) {
    logger.warn('original_download_empty', { diagId: diagId || null, rid: rid || null, bucket, path });
    return null;
  }
  return buffer;
}

export async function fetchOriginalAsset({
  supabase,
  originalObjectKey,
  originalBucket,
  originalUrl,
  rid,
  diagId,
} = {}) {
  const normalized = normalizeOriginalReference({
    originalObjectKey,
    originalBucket,
    originalUrl,
  });
  const key = normalized.originalObjectKey;
  const bucket = normalized.originalBucket || DEFAULT_UPLOADS_BUCKET;
  const url = normalized.originalUrl || safeTrim(originalUrl) || null;
  const diag = diagId || null;
  const ridValue = rid || null;

  if (!key) {
    logger.warn('original_object_key_missing', { diagId: diag, rid: ridValue });
    throw makeErr('original_not_found', {
      status: 422,
      rid: ridValue || null,
      diagId: diag,
      originalObjectKey: null,
      originalUrl: url,
    });
  }

  let supabaseClient = supabase || null;
  if (!supabaseClient) {
    try {
      supabaseClient = getSupabaseAdmin();
    } catch (err) {
      logger.warn('original_supabase_unavailable', {
        diagId: diag,
        rid: ridValue,
        message: err?.message || err,
      });
    }
  }

  if (supabaseClient) {
    try {
      const buffer = await downloadFromSupabase({
        supabase: supabaseClient,
        bucket,
        path: key,
        rid: ridValue,
        diagId: diag,
      });
      if (buffer && buffer.length) {
        logger.info('fetch_original_asset', {
          diagId: diag,
          rid: ridValue || null,
          bucket,
          originalObjectKey: key || null,
          bytesLen: buffer.length,
        });
        return {
          buffer,
          source: { type: 'supabase', bucket, path: key },
        };
      }
    } catch (err) {
      logger.error('original_download_exception', {
        diagId: diag,
        rid: ridValue,
        bucket,
        path: key,
        message: err?.message || err,
      });
    }
  }

  throw makeErr('original_not_found', {
    status: 422,
    rid: ridValue || null,
    originalObjectKey: key || null,
    originalUrl: url,
    diagId: diag,
  });
}

export default fetchOriginalAsset;
