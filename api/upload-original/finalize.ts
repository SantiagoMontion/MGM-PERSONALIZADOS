import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { supa } from '../../lib/supa.js';
import logger from '../../lib/_lib/logger.js';
import { normalizeOriginalReference } from '../../lib/_lib/uploads.js';
import {
  ensureCors,
  respondCorsDenied,
  applyCorsHeaders,
} from '../_lib/cors.js';
import type { CorsDecision } from '../_lib/cors.js';

const UPLOAD_BUCKET = 'uploads';
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const EXTENSION_BY_MIME: Record<string, keyof typeof MIME_BY_EXTENSION> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

class InvalidBodyError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'InvalidBodyError';
    this.code = code;
  }
}

function applyUploadCors(
  req: VercelRequest,
  res: VercelResponse,
  decision?: CorsDecision,
): CorsDecision {
  const resolved = applyCorsHeaders(req, res, decision);
  try {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-file-name, x-diag');
  } catch {}
  return resolved;
}

function respondJson(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  status: number,
  payload: Record<string, unknown>,
): void {
  applyUploadCors(req, res, corsDecision);
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(payload);
    return;
  }
  res.statusCode = status;
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  } catch {}
  res.end(JSON.stringify(payload));
}

function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '');
}

function buildPublicUrl(baseUrl: string, key: string): string {
  const sanitizedKey = key.replace(/^\/+/, '');
  const segments = sanitizedKey
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  const path = segments.join('/');
  return `${baseUrl}/storage/v1/object/public/${UPLOAD_BUCKET}/${path}`;
}

async function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  const existing = (req as unknown as { body?: unknown }).body;
  if (existing && typeof existing === 'object' && !Buffer.isBuffer(existing)) {
    return existing as Record<string, unknown>;
  }
  if (typeof existing === 'string') {
    try {
      return JSON.parse(existing) as Record<string, unknown>;
    } catch {
      throw new InvalidBodyError('invalid_json');
    }
  }
  if (Buffer.isBuffer(existing)) {
    try {
      return JSON.parse(existing.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new InvalidBodyError('invalid_json');
    }
  }

  const raw = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', (err) => reject(err));
  });

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new InvalidBodyError('invalid_json');
  }
}

function extractOriginalKey(body: Record<string, unknown>): string | null {
  const candidates = [
    body.originalKey,
    body.object_key,
    body.objectKey,
    body.key,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function normalizeMime(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';
  const normalized = value.split(';')[0].trim().toLowerCase();
  if (normalized && EXTENSION_BY_MIME[normalized]) {
    const ext = EXTENSION_BY_MIME[normalized];
    const canonical = MIME_BY_EXTENSION[ext];
    if (canonical) {
      return canonical;
    }
  }
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized;
}

function resolveExpectedMime(originalKey: string, fallback: string | null | undefined): string {
  const extMatch = /\.([a-z0-9]{1,10})$/i.exec(originalKey);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }
  const normalizedFallback = normalizeMime(fallback);
  if (normalizedFallback) {
    return normalizedFallback;
  }
  return '';
}

function sanitizeExtension(ext: string): string {
  if (!ext) return '';
  return ext.replace(/^\.+/, '').trim().toLowerCase();
}

function extractExtensionFromKey(key: string): string {
  const match = /\.([^.\/]+)$/.exec(key || '');
  return match ? match[1].toLowerCase() : '';
}

function replaceKeyExtension(key: string, ext: string): string {
  const sanitizedExt = sanitizeExtension(ext);
  if (!key || !sanitizedExt) return key;
  const normalized = key.replace(/\\/g, '/');
  const lastDot = normalized.lastIndexOf('.');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastDot > lastSlash) {
    return `${normalized.slice(0, lastDot + 1)}${sanitizedExt}`;
  }
  return `${normalized}.${sanitizedExt}`;
}

function normalizeObjectKeyForResponse(key: string): string {
  if (!key) return '';
  return key.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

type StorageClient = ReturnType<typeof supa.storage.from>;

async function fetchMimeViaHead({
  storage,
  key,
  bucket,
  diagId,
}: {
  storage: StorageClient;
  key: string;
  bucket: string;
  diagId: string;
}): Promise<string> {
  try {
    const { data, error } = await storage.createSignedUrl(key, 60, { download: false });
    if (error || !data?.signedUrl) {
      logger.warn('upload-original finalize head_signed_url_failed', {
        diagId,
        bucket,
        objectKey: key,
        message: error?.message || null,
        status: error?.status || error?.statusCode || null,
      });
      return '';
    }
    const signedUrl = typeof data.signedUrl === 'string' ? data.signedUrl : '';
    if (!signedUrl) {
      return '';
    }
    const fetchFn = (globalThis as unknown as {
      fetch?: (input: string, init?: Record<string, unknown>) => Promise<unknown>;
    }).fetch;
    if (typeof fetchFn !== 'function') {
      logger.warn('upload-original finalize head_fetch_unavailable', {
        diagId,
        bucket,
        objectKey: key,
      });
      return '';
    }
    const headResponse = (await fetchFn(signedUrl, { method: 'HEAD' })) as {
      ok?: boolean;
      status?: number;
      headers?: { get?(name: string): string | null };
    };
    if (!headResponse?.ok) {
      logger.warn('upload-original finalize head_request_failed', {
        diagId,
        bucket,
        objectKey: key,
        status: headResponse?.status ?? null,
      });
      return '';
    }
    const header = headResponse.headers?.get?.('content-type') ?? null;
    return normalizeMime(header);
  } catch (error) {
    logger.warn('upload-original finalize head_exception', {
      diagId,
      bucket,
      objectKey: key,
      message: (error as Error)?.message || error,
    });
    return '';
  }
}

function pickFirstString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return '';
}

function resolveBucket(body: Record<string, unknown>): string {
  const bucket = pickFirstString(
    body.bucket,
    body.originalBucket,
    body.bucketName,
    body.storageBucket,
  );
  return bucket || UPLOAD_BUCKET;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = randomUUID();
  try {
    res.setHeader('X-Upload-Diag-Id', diagId);
  } catch {}

  const corsDecision = applyUploadCors(req, res, ensureCors(req, res));
  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    respondJson(req, res, corsDecision, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const code = error instanceof InvalidBodyError ? error.code : 'invalid_body';
    respondJson(req, res, corsDecision, 400, { ok: false, error: code, diagId });
    return;
  }

  const originalKey = extractOriginalKey(body);
  if (!originalKey) {
    respondJson(req, res, corsDecision, 400, { ok: false, error: 'original_key_required', diagId });
    return;
  }

  const bucket = resolveBucket(body);
  const normalized = normalizeOriginalReference({
    originalObjectKey: originalKey,
    originalBucket: bucket,
  });
  const resolvedBucket = normalized.originalBucket || UPLOAD_BUCKET;
  const resolvedKey = normalized.originalObjectKey;

  if (!resolvedKey) {
    respondJson(req, res, corsDecision, 422, { ok: false, error: 'original_key_invalid', diagId });
    return;
  }

  const expectedMime = resolveExpectedMime(
    resolvedKey,
    pickFirstString(
      body.expectedMime,
      body.expected_mime,
      body.mime,
      body.contentType,
      body.content_type,
      body.originalMime,
    ),
  );

  try {
    const storage = supa.storage.from(resolvedBucket);
    const directory = (() => {
      const dir = path.posix?.dirname(resolvedKey) ?? path.dirname(resolvedKey);
      return dir === '.' ? '' : dir;
    })();
    const baseName = path.posix?.basename(resolvedKey) ?? path.basename(resolvedKey);
    const { data: listed, error: listError } = await storage.list(directory, {
      limit: 100,
      search: baseName,
    });

    if (listError) {
      logger.error('upload-original finalize list_failed', {
        diagId,
        bucket: resolvedBucket,
        objectKey: resolvedKey,
        message: listError?.message || null,
        status: listError?.status || listError?.statusCode || null,
      });
      respondJson(req, res, corsDecision, 502, { ok: false, error: 'original_lookup_failed', diagId });
      return;
    }

    const match = Array.isArray(listed)
      ? listed.find((item) => item?.name === baseName)
      : null;

    if (!match) {
      respondJson(req, res, corsDecision, 404, { ok: false, error: 'original_not_found', diagId });
      return;
    }

    const metadata = (match as { metadata?: Record<string, unknown> })?.metadata ?? {};
    const metadataMime = (() => {
      if (metadata && typeof metadata === 'object' && 'mimetype' in metadata) {
        const mimeCandidate = (metadata as { mimetype?: unknown }).mimetype;
        if (typeof mimeCandidate === 'string') {
          return mimeCandidate;
        }
      }
      return '';
    })();
    const canonicalExpected = normalizeMime(expectedMime);
    let actualMime = normalizeMime(metadataMime);
    let actualMimeSource: 'metadata' | 'head' | 'expected' | 'unknown' = actualMime ? 'metadata' : 'unknown';

    if (!actualMime) {
      const headMime = await fetchMimeViaHead({
        storage,
        key: resolvedKey,
        bucket: resolvedBucket,
        diagId,
      });
      if (headMime) {
        actualMime = headMime;
        actualMimeSource = 'head';
      }
    }

    if (!actualMime && canonicalExpected) {
      actualMime = canonicalExpected;
      actualMimeSource = 'expected';
    }

    if (!actualMime || !ALLOWED_MIMES.has(actualMime)) {
      logger.warn('upload-original finalize unsupported_media', {
        diagId,
        bucket: resolvedBucket,
        objectKey: resolvedKey,
        actualMime: actualMime || null,
        expectedMime: canonicalExpected || null,
        actualMimeSource,
      });
      respondJson(req, res, corsDecision, 415, {
        ok: false,
        error: 'unsupported_media',
        diagId,
      });
      return;
    }

    const warnings: string[] = [];
    let finalStorageKey = resolvedKey;
    let finalNormalizedObjectKey = normalized.originalObjectKey || resolvedKey;

    if (canonicalExpected && canonicalExpected !== actualMime) {
      warnings.push('mime_mismatch');
      logger.warn('upload-original finalize mime_mismatch', {
        diagId,
        bucket: resolvedBucket,
        objectKey: resolvedKey,
        expectedMime: canonicalExpected,
        actualMime,
        actualMimeSource,
      });
      const replacementExtKey = EXTENSION_BY_MIME[actualMime];
      if (replacementExtKey) {
        const newStorageKey = replaceKeyExtension(resolvedKey, replacementExtKey);
        if (newStorageKey !== resolvedKey) {
          try {
            const { error: moveError } = await storage.move(resolvedKey, newStorageKey);
            if (moveError) {
              logger.warn('upload-original finalize move_failed', {
                diagId,
                bucket: resolvedBucket,
                fromKey: resolvedKey,
                toKey: newStorageKey,
                message: moveError?.message || null,
                status: moveError?.status || moveError?.statusCode || null,
              });
            } else {
              finalStorageKey = newStorageKey;
              finalNormalizedObjectKey = newStorageKey;
            }
          } catch (moveError) {
            logger.warn('upload-original finalize move_exception', {
              diagId,
              bucket: resolvedBucket,
              fromKey: resolvedKey,
              toKey: newStorageKey,
              message: (moveError as Error)?.message || moveError,
            });
          }
        }
      }
    }

    const baseUrl = normalizeBaseUrl(process.env.SUPABASE_URL);
    if (!baseUrl) {
      respondJson(req, res, corsDecision, 500, { ok: false, error: 'supabase_url_missing', diagId });
      return;
    }

    const sanitizedStorageKey = finalStorageKey.replace(/^\/+/, '');
    const finalExtension = extractExtensionFromKey(sanitizedStorageKey);
    const responseObjectKey = (() => {
      const originalKeyCandidate = typeof originalKey === 'string' ? originalKey.trim() : '';
      const base = originalKeyCandidate || `uploads/${sanitizedStorageKey}`;
      const replaced = finalExtension ? replaceKeyExtension(base, finalExtension) : base;
      return normalizeObjectKeyForResponse(replaced);
    })();
    const normalizedObjectKeyForResponse = normalizeObjectKeyForResponse(finalNormalizedObjectKey || sanitizedStorageKey);

    const originalUrl = buildPublicUrl(baseUrl, sanitizedStorageKey);

    const originalObjectKeyForResponse = normalizedObjectKeyForResponse || responseObjectKey;

    const responsePayload: Record<string, unknown> = {
      ok: true,
      originalUrl,
      originalKey: responseObjectKey,
      originalObjectKey: originalObjectKeyForResponse,
      publicUrl: originalUrl,
      public_url: originalUrl,
      objectKey: originalObjectKeyForResponse,
      object_key: originalObjectKeyForResponse,
      path: responseObjectKey,
      bucket: resolvedBucket,
      originalBucket: resolvedBucket,
      contentType: actualMime,
      content_type: actualMime,
      originalMime: actualMime,
      expectedMime: canonicalExpected || null,
      expected_mime: canonicalExpected || null,
      diagId,
    };

    if (warnings.length) {
      responsePayload.warnings = warnings;
    }

    logger.info('upload-original finalize', {
      diagId,
      bucket: resolvedBucket,
      objectKey: responseObjectKey,
      originalObjectKey: normalizedObjectKeyForResponse || responseObjectKey,
      storageKey: sanitizedStorageKey,
      actualMime,
      expectedMime: canonicalExpected || null,
      warnings: warnings.length ? warnings : undefined,
      actualMimeSource,
    });

    respondJson(req, res, corsDecision, 200, responsePayload);
  } catch (error) {
    logger.error('upload-original finalize exception', {
      diagId,
      bucket,
      originalKey,
      message: (error as Error)?.message || error,
    });
    respondJson(req, res, corsDecision, 500, { ok: false, error: 'finalize_failed', diagId });
  }
}
