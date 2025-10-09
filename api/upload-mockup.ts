import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import uploadMockup from '../lib/handlers/uploadMockup.js';
import logger from '../lib/_lib/logger.js';
import {
  ensureCors,
  respondCorsDenied,
  applyCorsHeaders,
  type CorsDecision,
} from './_lib/cors.js';

export const config = { api: { bodyParser: true, sizeLimit: '6mb' } };

type NormalizedBody = Record<string, unknown>;

type UploadMockupResult = Awaited<ReturnType<typeof uploadMockup>>;

type ReadBodyResult = { body: NormalizedBody; bytesLength: number };

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

async function readJsonBody(req: VercelRequest): Promise<ReadBodyResult> {
  const existing = (req as unknown as { body?: unknown }).body;
  if (existing && typeof existing === 'object' && !Buffer.isBuffer(existing)) {
    let bytesLength = 0;
    try {
      const serialized = JSON.stringify(existing);
      bytesLength = serialized ? Buffer.byteLength(serialized, 'utf8') : 0;
    } catch {
      bytesLength = 0;
    }
    return { body: existing as NormalizedBody, bytesLength };
  }
  if (typeof existing === 'string') {
    try {
      const parsed = JSON.parse(existing) as NormalizedBody;
      return { body: parsed, bytesLength: Buffer.byteLength(existing, 'utf8') };
    } catch {
      return { body: {}, bytesLength: Buffer.byteLength(existing, 'utf8') };
    }
  }
  if (Buffer.isBuffer(existing)) {
    try {
      const raw = existing.toString('utf8');
      const parsed = JSON.parse(raw) as NormalizedBody;
      return { body: parsed, bytesLength: existing.length };
    } catch {
      return { body: {}, bytesLength: existing.length };
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

  const bytesLength = raw ? Buffer.byteLength(raw, 'utf8') : 0;

  if (!raw) {
    return { body: {}, bytesLength };
  }

  try {
    return { body: JSON.parse(raw) as NormalizedBody, bytesLength };
  } catch {
    return { body: {}, bytesLength };
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
  let bodyBytesLength = 0;
  try {
    const result = await readJsonBody(req);
    body = result.body;
    bodyBytesLength = result.bytesLength;
  } catch {
    body = {};
    bodyBytesLength = 0;
  }

  const rid = resolveBodyValue(body, ['rid', 'mockupRid', 'mockup_rid']) || getHeaderString(req, 'x-rid') || '';
  const mockupUrl = resolveBodyValue(body, ['mockupUrl', 'mockup_url', 'url', 'publicUrl', 'public_url']);
  const mockupDataUrl = resolveBodyValue(body, ['mockupDataUrl', 'mockup_data_url', 'mockupDataurl', 'mockup_dataurl']);
  const fileName = getHeaderString(req, 'x-file-name') || '';

  const payloadSummary = {
    hasDataUrl: Boolean(mockupDataUrl),
    hasUrl: Boolean(mockupUrl),
  };

  if (!payloadSummary.hasDataUrl && !payloadSummary.hasUrl) {
    try {
      logger.warn('[upload-mockup] missing_payload', {
        diagId,
        hasDataUrl: payloadSummary.hasDataUrl,
        hasUrl: payloadSummary.hasUrl,
        bodyBytesLength,
      });
    } catch {}
  }

  const result = await uploadMockup({
    rid,
    mockupDataUrl,
    mockupUrl,
    diagId,
    fileName,
  });

  const status = normalizeResultStatus(result);
  applyUploadCors(req, res, corsDecision);

  if (!result.ok && result.error === 'missing_mockup') {
    try {
      logger.warn('[upload-mockup] missing_mockup', {
        diagId: result.diagId,
        hasDataUrl: payloadSummary.hasDataUrl,
        hasUrl: payloadSummary.hasUrl,
        bodyBytesLength,
      });
    } catch {}
  }

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
        ...(result.error === 'missing_mockup'
          ? {
              got: {
                hasDataUrl: payloadSummary.hasDataUrl,
                hasUrl: payloadSummary.hasUrl,
              },
            }
          : {}),
      };

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(responsePayload);
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(responsePayload));
}
