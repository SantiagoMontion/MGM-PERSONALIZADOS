// lib/cors.js
export function cors(req, res) {
  const allowedEnv = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
  const allowed = allowedEnv.split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';

  // Elegimos un origin permitido (o el primero configurado)
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.setHeader('Access-Control-Expose-Headers', 'X-Diag-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Solo enviá credentials si NO es "*"
  if (allowOrigin !== '*') {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true; // preflight resuelto
  }
  return false;
}
