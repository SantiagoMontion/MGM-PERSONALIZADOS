import { randomUUID } from 'node:crypto';
import { getEnv, mask } from '../_lib/env.js';
import { cors } from '../lib/cors.js';

export default async function handler(req, res) {
  const diagId = randomUUID?.() || Date.now().toString();
  res.setHeader('X-Diag-Id', diagId);
  if (cors(req, res)) return;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
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
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    return res.status(200).json({
      ok: false,
      error: err.message,
      meta: { missing: err.missing, hint: 'Check Supabase env vars' },
    });
  }
}
