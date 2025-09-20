import { getEnv, mask } from '../../_lib/env.js';

/**
 * GET /api/env-check → envCheck
 */
export async function envCheck() {
  try {
    const env = getEnv();
    return {
      status: 200,
      body: {
        ok: true,
        env: {
          SUPABASE_URL: env.SUPABASE_URL,
          SUPABASE_SERVICE_ROLE: mask(env.SUPABASE_SERVICE_ROLE),
        },
      },
    };
  } catch (err) {
    return {
      status: 200,
      body: {
        ok: false,
        error: err.message,
        meta: { missing: err.missing, hint: 'Check Supabase env vars' },
      },
    };
  }
}

/**
 * GET /api/cors-diagnose → corsDiagnose
 */
export async function corsDiagnose({ headers }) {
  const origin = (headers.origin || '').replace(/\/$/, '');
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/\/$/, ''));
  console.log('[cors-diagnose]', { origin, allowed });
  return { status: 204, body: null };
}
