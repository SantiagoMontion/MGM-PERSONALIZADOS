import { createClient } from '@supabase/supabase-js';

const url = typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL.trim() : '';
const serviceRole = typeof process.env.SUPABASE_SERVICE_ROLE === 'string'
  ? process.env.SUPABASE_SERVICE_ROLE.trim()
  : '';

if (!url || !serviceRole) {
  throw new Error('Supabase environment variables are not configured');
}

export const supa = createClient(
  url,
  serviceRole,
  { auth: { persistSession: false } }
);
