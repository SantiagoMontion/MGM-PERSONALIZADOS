export default async function handler(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      runtime: "nodejs20.x",
      node: process.version,
      ts: Date.now()
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "unknown" });
  }
}
