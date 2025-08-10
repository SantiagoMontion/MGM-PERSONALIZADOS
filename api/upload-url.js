export default function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({
      error: "missing_env",
      have: {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE
      }
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  res.status(200).json({ ok: true });
}
