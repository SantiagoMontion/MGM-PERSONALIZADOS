import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOW_HEADERS = 'Content-Type, Authorization, X-Debug-Fast';

type CorsDecision = {
  allowed: boolean;
  strict: boolean;
};

function parseAllowlist(): string[] {
  const raw = process.env.CORS_ALLOWLIST;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveOrigin(
  requestOrigin: string | undefined,
  allowlist: string[],
): { headerOrigin: string; allowed: boolean } {
  if (allowlist.length === 0) {
    return { headerOrigin: requestOrigin || '*', allowed: true };
  }

  const trimmed = requestOrigin?.trim();
  if (trimmed && allowlist.includes(trimmed)) {
    return { headerOrigin: trimmed, allowed: true };
  }

  const fallback = allowlist[0] || '*';
  return { headerOrigin: fallback, allowed: false };
}

export function applyCors(
  req: VercelRequest,
  res: VercelResponse,
  allowMethods: string,
): CorsDecision {
  const allowlist = parseAllowlist();
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const { headerOrigin, allowed } = resolveOrigin(originHeader, allowlist);

  res.setHeader('Access-Control-Allow-Origin', headerOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', allowMethods);
  res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);

  return { allowed, strict: allowlist.length > 0 };
}

export function ensureJsonContentType(res: VercelResponse) {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }
}
