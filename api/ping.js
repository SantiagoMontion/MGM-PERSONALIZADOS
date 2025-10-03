export default function handler(_req, res) {\n  res.setHeader('Content-Type', 'application/json');\n  res.status(200).json({ ok: true, ts: Date.now() });\n}\n
