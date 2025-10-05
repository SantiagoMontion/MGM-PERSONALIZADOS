import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllowedOriginsFromEnv, resolveCorsDecision } from '../../_lib/cors.ts';

const ALLOW_METHODS = 'GET,OPTIONS';
const ALLOW_HEADERS = 'X-Admin-Token, Content-Type';

export type AnalyticsCorsResult = {
  decision: ReturnType<typeof resolveCorsDecision>;
};

function resolveOriginHeader(req: VercelRequest): string | undefined {
  const { origin } = req.headers;
  if (typeof origin === 'string' && origin.trim().length > 0) {
    return origin;
  }
  return undefined;
}

export function applyAnalyticsCors(
  req: VercelRequest,
  res: VercelResponse,
): AnalyticsCorsResult {
  const originHeader = resolveOriginHeader(req);
  const decision = resolveCorsDecision(originHeader, getAllowedOriginsFromEnv());
  const allowOrigin = decision.allowedOrigin ?? decision.requestedOrigin ?? null;

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }

  return { decision };
}
