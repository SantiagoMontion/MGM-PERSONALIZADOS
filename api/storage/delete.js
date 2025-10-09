import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  const diagId = randomUUID();
  const decision = ensureCors(req, res);
  if (!decision?.allowed || !decision?.allowedOrigin) {
    respondCorsDenied(req, res, decision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    res.status(405).json({ ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== 'object') {
      body = {};
    }

    const bucket = typeof body.bucket === 'string' ? body.bucket.trim() : '';
    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!bucket || !path) {
      res.status(400).json({ ok: false, error: 'missing_bucket_or_path', diagId });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      throw error;
    }

    res.status(200).json({ ok: true, removed: data || [], diagId });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'delete_failed',
      diagId,
      message: err?.message || 'delete_failed',
    });
  }
}
