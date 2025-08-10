
import { supa } from '../lib/supa.js';
import { cors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: "missing_env" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    // ping mínimo: lista el bucket (no sube nada)
    const { data, error } = await supa.storage.listBuckets();
    if (error) return res.status(500).json({ error: "supabase_fail", detail: String(error.message || error) });
    return res.status(200).json({ ok: true, buckets: (data || []).map(b=>b.name) });
  } catch (e) {
    return res.status(500).json({ error: "supabase_crash", detail: String(e?.message || e) });
  }
}
