import type { VercelRequest } from '@vercel/node';
import { getAllowedOriginsFromEnv, resolveCorsDecision } from '../../_lib/cors.ts';

const ALLOW_METHODS = 'GET,OPTIONS';
const ALLOW_HEADERS = 'X-Admin-Token, Content-Type, Accept';

export type AnalyticsCorsResult = {
  origin: string | null;
  headers: Record<string, string>;
  isAllowed: boolean;
};

export function applyAnalyticsCors(req: VercelRequest): AnalyticsCorsResult {
  const originHeader =
    typeof req.headers.origin === 'string' && req.headers.origin.trim().length > 0
      ? req.headers.origin
      : undefined;

  const allowedOrigins = getAllowedOriginsFromEnv();
  const allowAll = allowedOrigins.length === 0;

  if (allowAll) {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': ALLOW_METHODS,
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Expose-Headers': 'X-Diag-Id',
      Vary: 'Origin',
    };

    return {
      origin: '*',
      headers,
      isAllowed: true,
    };
  }

  const decision = resolveCorsDecision(originHeader, allowedOrigins);

  const resolvedOrigin = decision.allowed
    ? decision.allowedOrigin ?? decision.requestedOrigin
    : decision.requestedOrigin ?? decision.allowedOrigin;

  const origin = resolvedOrigin ?? null;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin ?? 'null',
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Expose-Headers': 'X-Diag-Id',
    Vary: 'Origin',
  };

  return {
    origin,
    headers,
    isAllowed: decision.allowed,
  };
}
