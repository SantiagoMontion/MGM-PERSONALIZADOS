const ALLOWED_ORIGINS = new Set<string>([
  'https://mgmgamers.store',
  'https://www.mgmgamers.store',
  'https://mgm-api.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization, X-Requested-With, Accept';

export function buildCorsHeaders(origin: string | null) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  } as Record<string,string>;
}

export function preflight(origin: string | null) {
  const cors = buildCorsHeaders(origin);
  if (!cors) {
    return new Response(JSON.stringify({ error:'origin_not_allowed' }), {
      status: 403, headers: { 'Content-Type':'application/json' }
    });
  }
  return new Response(null, { status: 204, headers: cors });
}

export function applyCorsToResponse(res: Response, cors: Record<string,string> | null) {
  if (!cors) return res;
  Object.entries(cors).forEach(([k,v]) => res.headers.set(k, v));
  return res;
}
