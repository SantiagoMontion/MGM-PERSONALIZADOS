export default function handler(req, res) {
  const origin = req.headers.origin || '';
  const allow = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://mgmgamers.store',
    'https://www.mgmgamers.store',
  ]);
  if (allow.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, ts: Date.now() }));
}

