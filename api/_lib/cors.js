// api/_lib/cors.js
export function cors(req, res) {
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  // seguridad
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src https: data:; connect-src https:; script-src 'none'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Idempotency-Key, Authorization, apikey, x-client-info'
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-Diag-Id');

  if (allowed.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
