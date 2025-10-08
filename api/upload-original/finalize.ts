import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import logger from '../../lib/_lib/logger.js';
import {
  ensureCors,
  handlePreflight,
  respondCorsDenied,
  applyCorsHeaders,
  type CorsDecision,
} from '../_lib/cors.js';

const UPLOAD_BUCKET = 'uploads';

function normalizeBaseUrl(raw?: string | null): string {
  return typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function respond(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  status: number,
  payload: Record<string, any>,
): void {
  applyCorsHeaders(req, res, corsDecision);
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

async function readJsonBody(req: VercelRequest): Promise<Record<string, any> | null> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, any>;
  }
  const raw = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', (err) => reject(err));
  });
  if (!raw) return {};
  try {
    return JSON.parse(String(raw));
  } catch (err) {
    logger.warn?.('upload-original finalize invalid_json', { error: err?.message || err });
    return null;
  }
}

function parseString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseNumber(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = randomUUID();
  res.setHeader('X-Upload-Diag-Id', diagId);

  const corsDecision = ensureCors(req, res);
  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  const method = (req.method || '').toUpperCase();
  if (method === 'OPTIONS') {
    handlePreflight(req, res, corsDecision);
    return;
  }
  if (method !== 'POST') {
    respond(req, res, corsDecision, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    respond(req, res, corsDecision, 400, { ok: false, error: 'invalid_body', diagId });
    return;
  }

  const objectKey = parseString(body.objectKey) || parseString(body.object_key);
  if (!objectKey) {
    respond(req, res, corsDecision, 400, { ok: false, error: 'object_key_required', diagId });
    return;
  }

  const sessionId = parseString(body.sessionId) || parseString(body.session_id);
  const rid = parseString(body.rid);
  const declaredContentType = parseString(body.contentType)
    || parseString(body.content_type)
    || null;
  const declaredSize = parseNumber(body.sizeBytes)
    ?? parseNumber(body.size_bytes)
    ?? null;

  const baseUrl = normalizeBaseUrl(process.env.SUPABASE_URL);
  const serviceRole = parseString(process.env.SUPABASE_SERVICE_ROLE);
  if (!baseUrl || !serviceRole) {
    respond(req, res, corsDecision, 500, { ok: false, error: 'supabase_not_configured', diagId });
    return;
  }

  const objectUrl = `${baseUrl}/storage/v1/object/${UPLOAD_BUCKET}/${encodePath(objectKey)}`;

  try {
    const headResponse = await fetch(objectUrl, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${serviceRole}` },
    });

    if (headResponse.status === 404) {
      respond(req, res, corsDecision, 404, { ok: false, error: 'object_not_found', diagId });
      return;
    }

    if (!headResponse.ok) {
      logger.error?.('upload-original finalize head_failed', {
        diagId,
        status: headResponse.status,
        statusText: headResponse.statusText,
        objectKey,
      });
      respond(req, res, corsDecision, 502, { ok: false, error: 'storage_unavailable', diagId });
      return;
    }

    const contentType = declaredContentType || headResponse.headers.get('content-type') || null;
    const contentLengthHeader = headResponse.headers.get('content-length');
    const sizeBytes = declaredSize ?? (contentLengthHeader ? Number(contentLengthHeader) : null);
    const etag = headResponse.headers.get('etag') || null;

    const canonical = `${baseUrl}/storage/v1/object/public/${UPLOAD_BUCKET}/${encodePath(objectKey)}`;

    respond(req, res, corsDecision, 200, {
      ok: true,
      diagId,
      sessionId: sessionId || undefined,
      originalKey: objectKey,
      originalUrl: canonical,
      publicUrl: canonical,
      file_original_url: canonical,
      rid: rid || undefined,
      contentType,
      sizeBytes,
      etag,
    });
  } catch (err) {
    logger.error?.('upload-original finalize exception', {
      diagId,
      error: err?.message || err,
      objectKey,
    });
    respond(req, res, corsDecision, 500, { ok: false, error: 'finalize_exception', diagId });
  }
}
