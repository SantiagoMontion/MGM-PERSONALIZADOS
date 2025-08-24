import crypto from 'node:crypto';
import { getEnv, mask } from './_lib/env.js';
import { cors } from './_lib/cors.js';

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  try {
    const env = getEnv();
    return res.status(200).json({
      ok: true,
      env: {
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE: mask(env.SUPABASE_SERVICE_ROLE),
      },
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: err.message,
      meta: { missing: err.missing, hint: 'Check Supabase env vars' },
    });
  }
}
