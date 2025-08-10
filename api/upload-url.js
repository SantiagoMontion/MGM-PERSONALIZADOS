// /api/upload-url.js (test 1 - mínimo, sin imports)
export default function handler(req, res) {
  res.status(200).json({ ok: true, method: req.method || null });
}