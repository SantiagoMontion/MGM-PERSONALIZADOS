import { randomUUID } from 'node:crypto';
import { supa } from '../supa.js';
import logger from '../_lib/logger.js';

const UPLOAD_BUCKET = 'uploads';
const MAX_SIZE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME_MAP = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
]);

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRid(value) {
  const trimmed = safeTrim(value).toLowerCase();
  if (!trimmed) {
    return '';
  }
  const sanitized = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitized) {
    return '';
  }
  return sanitized.slice(0, 60);
}

function parseDataUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  const [, rawMime, rawBase64] = match;
  const normalizedMime = rawMime.trim().toLowerCase();
  const mappedMime = normalizedMime === 'image/jpg' ? 'image/jpeg' : normalizedMime;
  const extension = ALLOWED_MIME_MAP.get(mappedMime);
  if (!extension) {
    return null;
  }
  try {
    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length) {
      return null;
    }
    return { buffer, contentType: mappedMime, extension };
  } catch {
    return null;
  }
}

function buildObjectKey({ rid, extension, diagId }) {
  const safeRid = normalizeRid(rid) || 'mockup';
  const safeDiag = safeTrim(diagId).replace(/[^a-z0-9]+/gi, '').toLowerCase() || randomUUID().replace(/[^a-z0-9]+/gi, '');
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `mockups/${safeRid}/${timestamp}-${safeDiag.slice(0, 12)}.${extension}`;
}

async function uploadBufferToSupabase({ buffer, contentType, objectKey, diagId }) {
  const storage = supa.storage.from(UPLOAD_BUCKET);
  const uploadResult = await storage.upload(objectKey, buffer, {
    contentType,
    cacheControl: '31536000',
    upsert: true,
  });

  if (uploadResult?.error) {
    try {
      logger.error('upload_mockup_supabase_upload_failed', {
        diagId,
        bucket: UPLOAD_BUCKET,
        objectKey,
        message: uploadResult.error?.message || uploadResult.error,
        status: uploadResult.error?.status ?? null,
      });
    } catch {}
    const error = new Error('supabase_upload_failed');
    error.code = 'supabase_upload_failed';
    throw error;
  }

  const { data: publicData } = storage.getPublicUrl(objectKey);
  if (publicData?.publicUrl) {
    return { url: publicData.publicUrl, objectKey };
  }

  try {
    const { data: signedData, error: signedError } = await storage.createSignedUrl(objectKey, 3600);
    if (!signedError && signedData?.signedUrl) {
      return { url: signedData.signedUrl, objectKey };
    }
    if (signedError) {
      try {
        logger.warn('upload_mockup_signed_url_failed', {
          diagId,
          bucket: UPLOAD_BUCKET,
          objectKey,
          message: signedError?.message || signedError,
          status: signedError?.status ?? null,
        });
      } catch {}
    }
  } catch (err) {
    try {
      logger.warn('upload_mockup_signed_url_exception', {
        diagId,
        bucket: UPLOAD_BUCKET,
        objectKey,
        message: err?.message || err,
      });
    } catch {}
  }

  return { url: '', objectKey };
}

export default async function uploadMockup({
  rid,
  mockupDataUrl,
  mockupUrl,
  diagId,
} = {}) {
  const effectiveDiagId = safeTrim(diagId) || randomUUID();
  const normalizedUrl = safeTrim(mockupUrl);
  if (normalizedUrl) {
    return {
      ok: true,
      diagId: effectiveDiagId,
      mockupUrl: normalizedUrl,
      mockupObjectKey: null,
    };
  }

  const normalizedDataUrl = safeTrim(mockupDataUrl);
  if (!normalizedDataUrl) {
    return {
      ok: false,
      diagId: effectiveDiagId,
      error: 'missing_mockup',
    };
  }

  const parsed = parseDataUrl(normalizedDataUrl);
  if (!parsed) {
    return {
      ok: false,
      diagId: effectiveDiagId,
      error: 'invalid_mockup_dataurl',
    };
  }

  if (parsed.buffer.length > MAX_SIZE_BYTES) {
    return {
      ok: false,
      diagId: effectiveDiagId,
      error: 'mockup_too_large',
    };
  }

  const objectKey = buildObjectKey({ rid, extension: parsed.extension, diagId: effectiveDiagId });
  try {
    const { url } = await uploadBufferToSupabase({
      buffer: parsed.buffer,
      contentType: parsed.contentType,
      objectKey,
      diagId: effectiveDiagId,
    });
    if (!url) {
      return {
        ok: false,
        diagId: effectiveDiagId,
        error: 'mockup_url_unavailable',
      };
    }

    return {
      ok: true,
      diagId: effectiveDiagId,
      mockupUrl: url,
      mockupObjectKey: objectKey,
    };
  } catch (err) {
    try {
      logger.error('upload_mockup_failure', {
        diagId: effectiveDiagId,
        bucket: UPLOAD_BUCKET,
        objectKey,
        message: err?.message || err,
      });
    } catch {}

    return {
      ok: false,
      diagId: effectiveDiagId,
      error: 'upload_failed',
    };
  }
}
