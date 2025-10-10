import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  applyCorsHeaders as applySharedCorsHeaders,
  ensureCors as ensureSharedCors,
  getAllowedOriginsFromEnv as sharedGetAllowedOrigins,
  handlePreflight as handleSharedPreflight,
  respondCorsDenied as respondSharedCorsDenied,
  resolveCorsDecision as sharedResolveCorsDecision,
  type CorsDecision,
} from '../../lib/cors.js';

export type { CorsDecision } from '../../lib/cors.js';

export const getAllowedOriginsFromEnv = sharedGetAllowedOrigins;

export const resolveCorsDecision = sharedResolveCorsDecision;

export function ensureCors(req: VercelRequest, res: VercelResponse): CorsDecision {
  return ensureSharedCors(req, res);
}

export function applyCors(
  req: VercelRequest,
  res: VercelResponse,
  decision?: CorsDecision,
): CorsDecision {
  const resolved = applySharedCorsHeaders(req, res, decision);
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  return resolved;
}

export function handlePreflight(
  req: VercelRequest,
  res: VercelResponse,
  decision: CorsDecision,
): void {
  handleSharedPreflight(req, res, decision);
}

export function respondCorsDenied(
  req: VercelRequest,
  res: VercelResponse,
  decision: CorsDecision,
  diagId: string,
): void {
  respondSharedCorsDenied(req, res, decision, diagId);
}

export function applyCorsHeaders(
  req: VercelRequest,
  res: VercelResponse,
  decision?: CorsDecision,
): CorsDecision {
  return applySharedCorsHeaders(req, res, decision);
}

export function ensureJsonContentType(res: VercelResponse): void {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
}
