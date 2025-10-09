import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
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
  return value.split(';')[0].trim().toLowerCase();
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

  const expectedMime = resolveExpectedMime(resolvedKey, pickFirstString(body.mime, body.contentType, body.content_type, body.originalMime));

  try {
    const storage = supa.storage.from(resolvedBucket);
    const { data: signed, error } = await storage.createSignedUrl(resolvedKey, 120);
    if (error || !signed?.signedUrl) {
      logger.error('upload-original finalize signed_url_failed', {
        diagId,
        bucket: resolvedBucket,
        objectKey: resolvedKey,
        message: error?.message || null,
        status: error?.status || error?.statusCode || null,
      });
      respondJson(req, res, corsDecision, 404, { ok: false, error: 'original_not_found', diagId });
      return;
    }

    const fetchFn = (globalThis as any)?.fetch as typeof fetch | undefined;
    if (typeof fetchFn !== 'function') {
      respondJson(req, res, corsDecision, 500, { ok: false, error: 'fetch_unavailable', diagId });
      return;
    }

    const headResponse = await fetchFn(signed.signedUrl, { method: 'HEAD' });
    if (!headResponse.ok) {
      if (headResponse.status === 404) {
        respondJson(req, res, corsDecision, 404, { ok: false, error: 'original_not_found', diagId });
        return;
      }
      respondJson(req, res, corsDecision, 502, {
        ok: false,
        error: 'original_not_accessible',
        status: headResponse.status,
        diagId,
      });
      return;
    }

    const actualMime = normalizeMime(headResponse.headers.get('content-type'))
      || normalizeMime(expectedMime);
    const canonicalExpected = normalizeMime(expectedMime);

    if (canonicalExpected && actualMime && canonicalExpected !== actualMime) {
      respondJson(req, res, corsDecision, 409, {
        ok: false,
        error: 'content_type_mismatch',
        expected: canonicalExpected,
        actual: actualMime,
        diagId,
      });
      return;
    }

    const baseUrl = normalizeBaseUrl(process.env.SUPABASE_URL);
    if (!baseUrl) {
      respondJson(req, res, corsDecision, 500, { ok: false, error: 'supabase_url_missing', diagId });
      return;
    }

    const originalUrl = buildPublicUrl(baseUrl, resolvedKey);
    const responseObjectKey = (() => {
      if (typeof originalKey === 'string' && originalKey.trim()) {
        return originalKey.trim();
      }
      return `uploads/${resolvedKey}`.replace(/\/+/, '/');
    })();

    logger.info('upload-original finalize', {
      diagId,
      bucket: resolvedBucket,
      objectKey: responseObjectKey,
      storageKey: resolvedKey,
      mime: actualMime || canonicalExpected || null,
    });

    respondJson(req, res, corsDecision, 200, {
      ok: true,
      originalUrl,
      originalKey: responseObjectKey,
      objectKey: responseObjectKey,
      object_key: responseObjectKey,
      path: responseObjectKey,
      bucket: resolvedBucket,
      originalBucket: resolvedBucket,
      contentType: actualMime || canonicalExpected || null,
      content_type: actualMime || canonicalExpected || null,
      originalMime: actualMime || canonicalExpected || null,
      diagId,
    });
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
