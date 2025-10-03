import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOW_HEADERS = 'Content-Type, Authorization, X-Debug-Fast, Accept, X-Requested-With';
const ALLOW_METHODS = 'POST, OPTIONS';
const ALLOW_SUFFIXES = (process.env.CORS_ALLOW_SUFFIXES || '.vercel.app')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

function isSuffixAllowed(originHeader: string): boolean {
  try {
    const url = new URL(originHeader);
    if (!/^https?:$/.test(url.protocol)) {
      return false;
    }
    return ALLOW_SUFFIXES.some((suffix) => url.hostname === suffix || url.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function resolveAllowedOrigin(originHeader: string | undefined): string {
  if (!originHeader) {
    return '*';
  }

  const allowList = process.env.CORS_ALLOWLIST
    ? process.env.CORS_ALLOWLIST.split(',').map((entry) => entry.trim()).filter(Boolean)
    : [];

  if (allowList.length === 0) {
    return isSuffixAllowed(originHeader) ? originHeader : '*';
  }

  if (allowList.includes(originHeader) || isSuffixAllowed(originHeader)) {
    return originHeader;
  }

  return '*';
}

export function applyCors(req: VercelRequest, res: VercelResponse): void {
  const originHeader =
    typeof req.headers.origin === 'string' && req.headers.origin.trim().length > 0
      ? req.headers.origin
      : undefined;
  const headerOrigin = resolveAllowedOrigin(originHeader);

  res.setHeader('Access-Control-Allow-Origin', headerOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);

  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }
}

export function ensureJsonContentType(res: VercelResponse) {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }
}
