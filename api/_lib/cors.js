// api/_lib/cors.js
export function cors(req, res) {
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  try {
    const raw = process.env.ALLOWED_ORIGINS || '';
    const allowed = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/\/$/, '')); // sin barra final

    // Métodos / headers permitidos
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Idempotency-Key, X-Diag-Id'
    );
    // Exponer diag al front para debug
    res.setHeader('Access-Control-Expose-Headers', 'X-Diag-Id');

    if (allowed.length === 0) {
      // Lista vacía -> permitir todos
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    // Si no matchea: no seteamos ACAO (el navegador bloqueará)

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return true; // cortocircuito preflight OK SIEMPRE
    }
    return false;
  } catch (e) {
    // Incluso si algo falla, respondemos preflight
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Idempotency-Key, X-Diag-Id'
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Diag-Id');
    res.status(204).end();
    return true;
  }
}
