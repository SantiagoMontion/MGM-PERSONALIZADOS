export default function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).send(JSON.stringify({ ok: true, ts: Date.now() }));
}

