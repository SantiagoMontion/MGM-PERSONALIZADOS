export const ALLOWED_ORIGINS = new Set([
  'https://mgmgamers.store',
  'https://www.mgmgamers.store',
  'https://mgmgamers-store.myshopify.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
]);

const ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOW_HEADERS =
  'Content-Type, Authorization, X-Requested-With, X-Shopify-Access-Token, X-Shopify-Shop-Domain';

export function buildCorsHeaders(origin: string | null) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return null;
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  } as Record<string, string>;
}

export function preflight(origin: string | null) {
  const headers = buildCorsHeaders(origin);
  if (!headers) {
    return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(null, {
    status: 204,
    headers: { ...headers, 'Content-Length': '0' },
  });
}

export function applyCorsToResponse(res: Response, origin: string | null) {
  const headers = buildCorsHeaders(origin);
  if (!headers) return res;
  Object.entries(headers).forEach(([k, v]) => res.headers.set(k, String(v)));
  return res;
}

export function withCors(handler: (req: any, res: any) => any) {
  return async function corsWrapped(req: any, res: any) {
    const origin = req.headers?.origin || null;
    const cors = buildCorsHeaders(origin);
    if (req.method === 'OPTIONS') {
      if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      res.setHeader('Content-Length', '0');
      return res.status(204).end();
    }
    if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return handler(req, res);
  };
}
