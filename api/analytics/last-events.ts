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
  const { origin, headers, isAllowed } = applyAnalyticsCors(req);

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      res.setHeader(key, value);
    }
  }

  if (req.method === 'OPTIONS') {
    return sendResponse(
      res,
      new Response(null, { status: isAllowed ? 204 : 403, headers }),
    );
  }

  if (req.method !== 'GET') {
    return sendResponse(
      res,
      Response.json(
        { ok: false, error: 'method_not_allowed', diagId },
        { status: 405, headers },
      ),
    );
  }

  if (!isAllowed) {
    return sendResponse(
      res,
      Response.json(
        { ok: false, error: 'forbidden_origin', diagId },
        { status: 403, headers },
      ),
    );
  }

  try {
    const expectedToken = process.env.ADMIN_ANALYTICS_TOKEN;
    if (!expectedToken) {
      return sendResponse(
        res,
        Response.json(
          { ok: false, error: 'missing_env', diagId },
          { status: 200, headers },
        ),
      );
    }

    const rawToken = req.headers['x-admin-token'];
    const providedToken = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    if (!providedToken || providedToken !== expectedToken) {
      return sendResponse(
        res,
        Response.json(
          { ok: false, error: 'unauthorized', diagId },
          { status: 401, headers },
        ),
      );
    }

    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseAdmin();
    } catch (error) {
      logApiError('analytics-last-events', { diagId, step: 'init_supabase', error });
      return sendResponse(
        res,
        Response.json(
          { ok: false, error: 'missing_env', diagId },
          { status: 200, headers },
        ),
      );
    }

    const limit = parseLimit(req.query?.limit);

    const { data, error } = await supabase
      .from('track_events')
      .select('rid, event_name, origin, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      const queryError =
        error instanceof Error
          ? Object.assign(error, { step: 'fetch' as const })
          : Object.assign(new Error(JSON.stringify(error)), { step: 'fetch' as const });
      throw queryError;
    }

    const events = Array.isArray(data) ? (data as LastEventRow[]) : [];
    console.log('[analytics-last-events]', { diagId, origin });

    return sendResponse(
      res,
      Response.json(
        { ok: true, diagId, events },
        { status: 200, headers },
      ),
    );
  } catch (error) {
    const step =
      typeof error === 'object' && error && 'step' in error
        ? String((error as { step: string }).step)
        : 'unhandled';
    logApiError('analytics-last-events', { diagId, step, error });
    return sendResponse(
      res,
      Response.json(
        { ok: false, error: String(error), diagId },
        { status: 500, headers },
      ),
    );
  }
}

async function sendResponse(res: VercelResponse, response: Response) {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (response.status === 204) {
    res.end();
    return;
  }
  const body = await response.text();
  if (body.length > 0) {
    res.send(body);
  } else {
    res.end();
  }
}
