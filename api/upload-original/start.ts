import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import uploadUrl from '../../lib/handlers/uploadUrl.js';
import {
  ensureCors,
  handlePreflight,
  respondCorsDenied,
  applyCorsHeaders,
} from '../_lib/cors.js';
import type { CorsDecision } from '../_lib/cors.js';

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

  try {
    await uploadUrl(req as any, res as any);
  } catch (error) {
    if (!res.headersSent) {
      respondJson(req, res, corsDecision, 500, {
        ok: false,
        error: 'upload_unavailable',
        diagId,
      });
    }
  }
}
