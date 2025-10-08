import logger from './logger.js';
import getSupabaseAdmin from './supabaseAdmin.js';
import { makeErr } from './errors.js';

export const DEFAULT_UPLOADS_BUCKET = 'uploads';
const HTTP_URL_REGEX = /^https?:\/\//i;

function safeTrim(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
}

function normalizeBucket(value) {
  const trimmed = safeTrim(value);
  return trimmed || DEFAULT_UPLOADS_BUCKET;
}

function normalizeObjectKey(value) {
  const trimmed = safeTrim(value)
    .replace(/^storage\/v1\/object\//i, '')
    .replace(/^public\//i, '')
    .replace(/^uploads\//i, '')
    .replace(/^\/+/g, '');
  return trimmed || '';
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
  fetchImpl,
} = {}) {
  const key = normalizeObjectKey(originalObjectKey);
  const bucket = normalizeBucket(originalBucket);
  const diag = diagId || null;
  const ridValue = rid || null;

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

  if (key && supabaseClient) {
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
          url: Boolean(url),
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

  const url = safeTrim(originalUrl);
  if (url) {
    if (!HTTP_URL_REGEX.test(url)) {
      logger.warn('original_url_unsupported', { diagId: diag, rid: ridValue, url });
    } else {
      const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis?.fetch;
      if (typeof fetchFn !== 'function') {
        logger.error('original_fetch_missing', { diagId: diag, rid: ridValue, url });
      } else {
        try {
          const response = await fetchFn(url);
          if (!response.ok) {
            logger.warn('original_fetch_failed', {
              diagId: diag,
              rid: ridValue,
              url,
              status: response.status,
              statusText: response.statusText,
            });
          } else {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            if (buffer.length) {
              logger.info('fetch_original_asset', {
                diagId: diag,
                rid: ridValue || null,
                bucket,
                originalObjectKey: key || null,
                url: true,
                bytesLen: buffer.length,
              });
              return {
                buffer,
                source: { type: 'url', url, status: response.status },
              };
            }
            logger.warn('original_fetch_empty', { diagId: diag, rid: ridValue, url });
          }
        } catch (err) {
          logger.error('original_fetch_exception', { diagId: diag, rid: ridValue, url, message: err?.message || err });
        }
      }
    }
  }

  throw makeErr('original_not_found', {
    rid: ridValue || null,
    originalObjectKey: key || null,
    originalUrl: url || null,
    diagId: diag,
  });
}

export default fetchOriginalAsset;
