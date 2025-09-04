import { createClient } from '@supabase/supabase-js';
import { getEnv } from './env';

let client;

export function getSupabaseAdmin() {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = getEnv();
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return client;
}

export default getSupabaseAdmin;
