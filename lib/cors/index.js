// Single CORS helper with stable import path: `import { withCors, buildCorsHeaders } from '../lib/cors'`
// ESM (repo uses "type":"module"). No binary output.

const DEV_ALLOWED = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const PROD_ALLOWED = new Set([
  'https://mgmgamers.store',
  'https://www.mgmgamers.store',
  'https://mgm-api.vercel.app',
]);

function resolveAllowedOrigins() {
  const allowed = new Set([...DEV_ALLOWED, ...PROD_ALLOWED]);
  // Also allow this API's own origin when available
  const apiUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  if (apiUrl) allowed.add(apiUrl);
  const extra = process.env.API_PUBLIC_BASE;
  if (extra) allowed.add(extra);
  return allowed;
}

function pickOrigin(req) {
  const allowed = resolveAllowedOrigins();
  const origin = req.headers.origin || '';
  return allowed.has(origin) ? origin : 'https://www.mgmgamers.store';
}

function applyHeaders(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
    'Access-Control-Max-Age': '86400',
  };
}

export function withCors(handler) {
  return async (req, res) => {
    const origin = pickOrigin(req);
    if (process.env.DEBUG_CORS === '1') {
      try { console.info('[CORS]', { method: req.method, origin: req.headers.origin || '', url: req.url }); } catch {}
    }
    if (req.method === 'OPTIONS') {
      applyHeaders(res, origin);
      res.statusCode = 204;
      return res.end();
    }
    applyHeaders(res, origin);
    return handler(req, res);
  };
}

