export default function handler(req, res) {
  const origin = req.headers?.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  return res.status(200).json({ ok: true, ts: Date.now() });
}

