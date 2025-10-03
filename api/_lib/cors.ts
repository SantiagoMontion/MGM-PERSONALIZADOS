import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOW_HEADERS = 'Content-Type, Authorization, X-Debug-Fast';

export function applyCors(
  req: VercelRequest,
  res: VercelResponse,
  allowMethods: string,
): void {
  const originHeader =
    typeof req.headers.origin === 'string' && req.headers.origin.trim().length > 0
      ? req.headers.origin
      : undefined;
  const headerOrigin = originHeader ?? '*';

  res.setHeader('Access-Control-Allow-Origin', headerOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', allowMethods);
  res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
}

export function ensureJsonContentType(res: VercelResponse) {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }
}
