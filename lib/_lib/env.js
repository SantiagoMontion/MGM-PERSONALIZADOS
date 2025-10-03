try { await import('dotenv/config'); } catch {}

export function mask(value = '') {
  if (!value) return '';
  return `${value.slice(0, 6)}�?�****`;
}

export function getEnv() {
  const { SUPABASE_URL } = process.env;
  const SUPABASE_SERVICE_ROLE =
    process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE) missing.push('SUPABASE_SERVICE_ROLE');
  if (missing.length) {
    const err = new Error(`Missing required env vars: ${missing.join(', ')}`);
    err.missing = missing;
    throw err;
  }
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE };
}

export default { getEnv, mask };

