import { randomUUID } from 'node:crypto';
import { supa } from '../supa.js';
import logger from '../_lib/logger.js';
import { resolveUploadsObjectKey } from '../_lib/uploads.js';

const UPLOAD_BUCKET = 'uploads';
const MAX_SIZE_BYTES = 6 * 1024 * 1024;
const DEFAULT_CONTENT_TYPE = 'image/jpeg';
const ALLOWED_MIME_MAP = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
]);
const DEFAULT_EXTENSION = ALLOWED_MIME_MAP.get(DEFAULT_CONTENT_TYPE) || 'jpg';
const EXTENSION_MIME_MAP = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
]);
const FETCH_TIMEOUT_MS = 15_000;

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

function normalizeContentType(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const [base] = value.split(';', 1);
  const trimmed = base.trim().toLowerCase();
  if (trimmed === 'image/jpg') {
    return 'image/jpeg';
  }
  return trimmed;
}

function inferExtensionFromFilename(filename) {
  if (typeof filename !== 'string') {
    return '';
  }
  const match = /\.([a-z0-9]{1,10})$/i.exec(filename.trim());
  if (!match) {
    return '';
  }
  const ext = match[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

function resolveMimeFromExtension(extension) {
  const normalized = (extension || '').toLowerCase();
  if (!normalized) {
    return null;
  }
  const mapped = EXTENSION_MIME_MAP.get(normalized);
  if (!mapped) {
    return null;
  }
  return { contentType: mapped === 'image/jpg' ? 'image/jpeg' : mapped, extension: normalized === 'jpeg' ? 'jpg' : normalized };
}

function resolveMimeAndExtension({ contentType, filename }) {
  const normalizedMime = normalizeContentType(contentType);
  if (normalizedMime && ALLOWED_MIME_MAP.has(normalizedMime)) {
    const extension = ALLOWED_MIME_MAP.get(normalizedMime);
    return {
      contentType: normalizedMime === 'image/jpg' ? 'image/jpeg' : normalizedMime,
      extension,
    };
  }

  const extensionFromFile = inferExtensionFromFilename(filename);
  const resolvedFromFile = resolveMimeFromExtension(extensionFromFile);
  if (resolvedFromFile) {
    return resolvedFromFile;
  }

  return { contentType: DEFAULT_CONTENT_TYPE, extension: DEFAULT_EXTENSION };
}

function summarizeUrlForLog(url) {
  const trimmed = safeTrim(url);
  if (!trimmed) {
    return '';
  }
  if (/^blob:/i.test(trimmed)) {
    return 'blob:';
  }
  try {
    const instance = new URL(trimmed);
    const base = `${instance.origin}${instance.pathname}`;
    return base.length > 200 ? `${base.slice(0, 200)}…` : base;
  } catch {
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }
}

function buildObjectKey({ rid, extension, diagId }) {
  const safeRid = normalizeRid(rid) || 'mockup';
  const safeDiag = safeTrim(diagId).replace(/[^a-z0-9]+/gi, '').toLowerCase() || randomUUID().replace(/[^a-z0-9]+/gi, '');
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `mockups/${safeRid}/${timestamp}-${safeDiag.slice(0, 12)}.${extension}`;
}

async function downloadExternalMockup(url, { diagId }) {
  const trimmed = safeTrim(url);
  if (!trimmed) {
    return null;
  }

  const isHttp = /^https?:/i.test(trimmed);
  const isBlob = /^blob:/i.test(trimmed);
  if (!isHttp && !isBlob) {
    return null;
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;

  try {
    const response = await fetch(trimmed, controller ? { signal: controller.signal } : undefined);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      try {
        logger.warn('upload_mockup_fetch_failed', {
          diagId,
          status: response.status,
          url: summarizeUrlForLog(trimmed),
        });
      } catch {}
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      try {
        logger.warn('upload_mockup_fetch_empty', {
          diagId,
          url: summarizeUrlForLog(trimmed),
        });
      } catch {}
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    return { buffer, contentType };
  } catch (err) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    try {
      logger.warn('upload_mockup_fetch_exception', {
        diagId,
        url: summarizeUrlForLog(trimmed),
        message: err?.name === 'AbortError' ? 'fetch_timeout' : err?.message || err,
      });
    } catch {}
    return null;
  }
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
  fileName,
  diagId,
} = {}) {
  const effectiveDiagId = safeTrim(diagId) || randomUUID();
  const normalizedUrl = safeTrim(mockupUrl);
  const normalizedFileName = safeTrim(fileName);

  if (normalizedUrl) {
    const existingObjectKey = resolveUploadsObjectKey(normalizedUrl);
    if (existingObjectKey) {
      return {
        ok: true,
        diagId: effectiveDiagId,
        mockupUrl: normalizedUrl,
        mockupObjectKey: existingObjectKey,
      };
    }

    const downloaded = await downloadExternalMockup(normalizedUrl, { diagId: effectiveDiagId });
    if (downloaded && downloaded.buffer && downloaded.buffer.length) {
      if (downloaded.buffer.length > MAX_SIZE_BYTES) {
        return {
          ok: false,
          diagId: effectiveDiagId,
          error: 'mockup_too_large',
        };
      }

      const { contentType, extension } = resolveMimeAndExtension({
        contentType: downloaded.contentType,
        filename: normalizedFileName,
      });

      const objectKey = buildObjectKey({ rid, extension, diagId: effectiveDiagId });
      try {
        const { url } = await uploadBufferToSupabase({
          buffer: downloaded.buffer,
          contentType,
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
