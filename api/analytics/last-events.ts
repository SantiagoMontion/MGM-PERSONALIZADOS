import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import { createDiagId, logApiError } from '../_lib/diag.js';
import { applyAnalyticsCors } from './_lib/cors.ts';

export const config = { maxDuration: 10 };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type LastEventRow = {
  rid: string | null;
  event_name: string | null;
  origin: string | null;
  created_at: string | null;
};

function parseLimit(value: string | string[] | undefined): number {
  if (Array.isArray(value)) {
    return parseLimit(value[0]);
  }
  if (typeof value !== 'string') {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = createDiagId();
  res.setHeader('X-Diag-Id', diagId);
  const { decision } = applyAnalyticsCors(req, res);

  if (req.method === 'OPTIONS') {
    if (!decision.allowed) {
      res.status(403).json({ ok: false, error: 'origin_not_allowed', diagId });
      return;
    }
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  if (!decision.allowed) {
    res.status(403).json({ ok: false, error: 'origin_not_allowed', diagId });
    return;
  }

  const expectedToken = process.env.ADMIN_ANALYTICS_TOKEN;
  if (!expectedToken) {
    res.status(200).json({ ok: false, error: 'missing_env', diagId });
    return;
  }

  const rawToken = req.headers['x-admin-token'];
  const providedToken = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (!providedToken || providedToken !== expectedToken) {
    res.status(401).json({ ok: false, error: 'unauthorized', diagId });
    return;
  }

  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    logApiError('analytics-last-events', { diagId, step: 'init_supabase', error });
    res.status(200).json({ ok: false, error: 'missing_env', diagId });
    return;
  }

  const limit = parseLimit(req.query?.limit);

  try {
    const { data, error } = await supabase
      .from('track_events')
      .select('rid, event_name, origin, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    const events = Array.isArray(data) ? (data as LastEventRow[]) : [];
    res.status(200).json({ ok: true, diagId, events });
  } catch (error) {
    logApiError('analytics-last-events', { diagId, step: 'fetch', error });
    res.status(200).json({ ok: false, error: 'query_failed', diagId });
  }
}
