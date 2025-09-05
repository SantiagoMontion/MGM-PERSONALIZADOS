const ALLOWED = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://mgmgamers.store',
  'https://www.mgmgamers.store',
  // common API domain; also add dynamic below
  'https://mgm-api.vercel.app',
]);

function getApiOriginFromEnv() {
  // Vercel provides VERCEL_URL like "my-app.vercel.app" in prod/preview
  const host = process.env.VERCEL_URL;
  if (host && /^[-a-z0-9.]+$/.test(host)) return `https://${host}`;
  // user-provided override
  if (process.env.API_PUBLIC_ORIGIN) return String(process.env.API_PUBLIC_ORIGIN);
  return null;
}

function pickOrigin(req) {
  const o = req.headers.origin || '';
  const apiOrigin = getApiOriginFromEnv();
  if (apiOrigin) ALLOWED.add(apiOrigin);
  return ALLOWED.has(o) ? o : 'https://www.mgmgamers.store';
}

function applyCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function withCors(handler) {

  return async (req, res) => {
    try {
      const o = req.headers.origin || '';
      if (process.env.DEBUG_CORS === '1') {
        console.info('[CORS]', { method: req.method, origin: o, url: req.url });
      }
    } catch {}
    const origin = pickOrigin(req);
    if (req.method === 'OPTIONS') {
      applyCors(res, origin);
      res.statusCode = 204;
      return res.end();
    }
    applyCors(res, origin);
    return handler(req, res);
  };
}
