export function cors(req, res) {
  const allowedEnv = process.env.ALLOWED_ORIGINS || '';
  const allowed = allowedEnv.split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';

  if (allowed.length === 0) {
    // Sin restricciones: permitir cualquier origen (útil en desarrollo)
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
