// api/_lib/cors.js
export function cors(req, res) {
  try {
    const raw = process.env.ALLOWED_ORIGINS || '';
    const allowed = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/\/$/, '')); // sin barra final

    const origin = (req.headers.origin || '').replace(/\/$/, '');

    // Siempre informar qué variamos
    res.setHeader('Vary', 'Origin');

    // Métodos / headers permitidos
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
    // Exponer diag al front para debug
    res.setHeader('Access-Control-Expose-Headers', 'X-Diag-Id');

    const isDev = process.env.NODE_ENV !== 'production';

    if (allowed.length === 0) {
      // Sin lista -> en dev: *, en prod: eco del origin (si viene), o *
      res.setHeader('Access-Control-Allow-Origin', isDev ? '*' : (origin || '*'));
    } else if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (isDev && origin.startsWith('http://localhost:')) {
      // fallback dev para cualquier puerto local
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    // Si no matchea y es prod: no seteamos ACAO (el navegador bloqueará)

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return true; // cortocircuito preflight OK SIEMPRE
    }
    return false;
  } catch (e) {
    // Incluso si algo falla, respondemos preflight
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
    res.setHeader('Access-Control-Expose-Headers', 'X-Diag-Id');
    res.status(204).end();
    return true;
  }
}
