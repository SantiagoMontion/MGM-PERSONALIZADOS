import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';

function sendJson(res, status, payload) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(payload);
}

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
    sendJson(res, 405, { ok: false, error: 'method_not_allowed', diagId });
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
      sendJson(res, 400, { ok: false, error: 'missing_bucket_or_path', diagId });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      throw error;
    }

    sendJson(res, 200, { ok: true, removed: data || [], diagId });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: 'delete_failed',
      diagId,
      message: err?.message || 'delete_failed',
    });
  }
}
