// lib/cors.js
export function cors(req, res) {
  const allowedEnv = process.env.ALLOWED_ORIGINS || '';
  const allowed = allowedEnv.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const originRaw = req.headers.origin || '';
  const origin = originRaw.replace(/\/$/, '');
  const isDev = (process.env.NODE_ENV !== 'production') && (process.env.VERCEL_ENV !== 'production');

  let allowOrigin = '';
  if (allowed.length === 0) {
    allowOrigin = isDev ? '*' : origin;
  } else {
    if (allowed.includes(origin)) {
      allowOrigin = origin;
    } else if (isDev && origin.startsWith('http://localhost:')) {
      allowOrigin = origin;
    }
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Expose-Headers', 'X-Diag-Id');
  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    if (allowOrigin !== '*') res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (!allowOrigin) {
    if (req.method === 'OPTIONS') {
      res.status(403).json({ ok:false, error:'cors_origin_not_allowed', origin });
      return true;
    }
    return false;
  }

  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
