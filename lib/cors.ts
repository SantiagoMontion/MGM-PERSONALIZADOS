export const ALLOWED_ORIGINS = new Set([
  'https://mgmgamers.store',
  'https://www.mgmgamers.store',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
]);

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With';

export function buildCorsHeaders(origin: string | null) {
  if (!origin || !ALLOWED_ORIGINS.has(origin.replace(/\/$/, ''))) {
    return null;
  }
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Credentials': 'true',
  } as Record<string, string>;
}

export function handlePreflight(req: Request) {
  if (req.method !== 'OPTIONS') return null;
  const origin = req.headers.get('origin');
  const headers = buildCorsHeaders(origin);
  if (!headers) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(null, { status: 204, headers });
}

export function withCors(handler: any) {
  return async function (req: any, res: any) {
    const origin = (req.headers.origin || null) as string | null;
    const headers = buildCorsHeaders(origin);
    if (!headers) {
      res.statusCode = 403;
      return res.end();
    }
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    return handler(req, res);
  };
}

export function applyCorsToResponse(res: Response, origin: string | null) {
  const headers = buildCorsHeaders(origin);
  if (!headers) return null;
  Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}
