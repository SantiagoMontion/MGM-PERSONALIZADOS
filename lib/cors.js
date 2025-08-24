// lib/cors.js
export function cors(req, res) {
  const allowedEnv = process.env.ALLOWED_ORIGINS || '';
  const allowed = allowedEnv.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const originRaw = req.headers.origin || '';
  const origin = originRaw.replace(/\/$/, ''); // sin barra final

  let allowOrigin = '*';
  let allowCreds = false;

  if (allowed.length === 0) {
    // desarrollo abierto
    allowOrigin = '*';
  } else if (allowed.includes(origin)) {
    allowOrigin = origin;
    allowCreds = true; // solo si devolvemos un origin específico
  } else if (allowed.includes('*')) {
    allowOrigin = '*';
  } else {
    // Origen no permitido: corta preflight con 403 explícito
    if (req.method === 'OPTIONS') {
      res.status(403).json({ ok:false, error:'cors_origin_not_allowed', origin, allowed });
      return true;
    }
    // Para requests no-OPTIONS, seguir sin CORS; el navegador bloqueará
  }

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  if (allowCreds) res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.setHeader('Access-Control-Expose-Headers', 'X-Diag-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
