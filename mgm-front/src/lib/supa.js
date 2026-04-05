import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
const key = typeof rawKey === 'string' ? rawKey.trim() : '';

export const isSupabaseConfigured = Boolean(url && key);

/** Cliente real o null si faltan env (evita "supabaseUrl is required" en local / preview). */
export const supa = isSupabaseConfigured ? createClient(url, key) : null;
