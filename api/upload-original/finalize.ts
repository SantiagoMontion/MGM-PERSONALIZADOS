import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import {
  ensureCors,
  handlePreflight,
  respondCorsDenied,
  applyCorsHeaders,
} from '../_lib/cors.js';
import type { CorsDecision } from '../_lib/cors.js';

const UPLOAD_BUCKET = 'uploads';

class InvalidBodyError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'InvalidBodyError';
    this.code = code;
  }
}

function respondJson(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  status: number,
  payload: Record<string, unknown>,
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = randomUUID();
  try {
    res.setHeader('X-Upload-Diag-Id', diagId);
  } catch {}

  const corsDecision = ensureCors(req, res);
  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    handlePreflight(req, res, corsDecision);
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

  const baseUrl = normalizeBaseUrl(process.env.SUPABASE_URL);
  if (!baseUrl) {
    respondJson(req, res, corsDecision, 500, { ok: false, error: 'supabase_url_missing', diagId });
    return;
  }

  const originalUrl = buildPublicUrl(baseUrl, originalKey);

  const fetchFn = (globalThis as any)?.fetch as
    | ((input: any, init?: any) => Promise<any>)
    | undefined;

  if (typeof fetchFn !== 'function') {
    respondJson(req, res, corsDecision, 500, { ok: false, error: 'fetch_unavailable', diagId });
    return;
  }

  try {
    const response = await fetchFn(originalUrl, { method: 'HEAD' });
    if (!response.ok) {
      if (response.status === 404) {
        respondJson(req, res, corsDecision, 404, { ok: false, error: 'original_not_found', diagId });
        return;
      }
      respondJson(req, res, corsDecision, 502, {
        ok: false,
        error: 'original_not_accessible',
        status: response.status,
        diagId,
      });
      return;
    }
  } catch (error) {
    respondJson(req, res, corsDecision, 502, { ok: false, error: 'head_request_failed', diagId });
    return;
  }

  respondJson(req, res, corsDecision, 200, {
    ok: true,
    originalUrl,
    originalKey,
  });
}
