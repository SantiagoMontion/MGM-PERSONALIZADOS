import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import uploadMockup from '../lib/handlers/uploadMockup.js';
import {
  ensureCors,
  respondCorsDenied,
  applyCorsHeaders,
  type CorsDecision,
} from './_lib/cors.js';

export const config = { api: { bodyParser: true, sizeLimit: '4mb' } };

type NormalizedBody = Record<string, unknown>;

type UploadMockupResult = Awaited<ReturnType<typeof uploadMockup>>;

function applyUploadCors(
  req: VercelRequest,
  res: VercelResponse,
  decision?: CorsDecision,
): CorsDecision {
  const resolved = applyCorsHeaders(req, res, decision);
  try {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'content-type, x-file-name, x-diag, authorization',
    );
  } catch {}
  return resolved;
}

function getHeaderString(req: VercelRequest, name: string): string | null {
  const value = req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry.trim();
      }
    }
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

async function readJsonBody(req: VercelRequest): Promise<NormalizedBody> {
  const existing = (req as unknown as { body?: unknown }).body;
  if (existing && typeof existing === 'object' && !Buffer.isBuffer(existing)) {
    return existing as NormalizedBody;
  }
  if (typeof existing === 'string') {
    try {
      return JSON.parse(existing) as NormalizedBody;
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(existing)) {
    try {
      return JSON.parse(existing.toString('utf8')) as NormalizedBody;
    } catch {
      return {};
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
    return JSON.parse(raw) as NormalizedBody;
  } catch {
    return {};
  }
}

function resolveBodyValue(body: NormalizedBody, candidates: string[]): string {
  for (const key of candidates) {
    const value = body?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeResultStatus(result: UploadMockupResult): number {
  if (!result.ok) {
    if (result.error === 'missing_mockup' || result.error === 'invalid_mockup_dataurl') {
      return 400;
    }
    if (result.error === 'mockup_too_large') {
      return 413;
    }
    return 500;
  }
  return 200;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);

  const corsDecision = ensureCors(req, res);
  if (!corsDecision.allowed) {
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    applyUploadCors(req, res, corsDecision);
    if (typeof res.status === 'function') {
      res.status(204).end();
    } else {
      res.statusCode = 204;
      res.end();
    }
    return;
  }

  if ((req.method || '').toUpperCase() !== 'POST') {
    applyUploadCors(req, res, corsDecision);
    res.setHeader('Allow', 'POST, OPTIONS');
    const payload = { ok: false, error: 'method_not_allowed', diagId };
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      res.status(405).json(payload);
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify(payload));
    }
    return;
  }

  let body: NormalizedBody = {};
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }

  const rid = resolveBodyValue(body, ['rid', 'mockupRid', 'mockup_rid']) || getHeaderString(req, 'x-rid') || '';
  const mockupUrl = resolveBodyValue(body, ['mockupUrl', 'mockup_url', 'url', 'publicUrl', 'public_url']);
  const mockupDataUrl = resolveBodyValue(body, ['mockupDataUrl', 'mockup_data_url', 'mockupDataurl', 'mockup_dataurl']);

  const result = await uploadMockup({
    rid,
    mockupDataUrl,
    mockupUrl,
    diagId,
  });

  const status = normalizeResultStatus(result);
  applyUploadCors(req, res, corsDecision);

  const responsePayload: Record<string, unknown> = result.ok
    ? {
        ok: true,
        mockupUrl: result.mockupUrl,
        mockupObjectKey: result.mockupObjectKey ?? null,
        diagId: result.diagId,
      }
    : {
        ok: false,
        error: result.error || 'upload_failed',
        diagId: result.diagId,
      };

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(responsePayload);
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(responsePayload));
}
