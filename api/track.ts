import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDiagId, logApiError } from './_lib/diag.js';
import { getAllowedOriginsFromEnv, resolveCorsDecision, type CorsDecision } from './_lib/cors.ts';

const ALLOWED_EVENTS = new Set<string>([
  'mockup_view',
  'continue_design',
  'view_purchase_options',
  'cta_click_public',
  'cta_click_private',
  'cta_click_cart',
]);

const DUPLICATE_WINDOW_MS = 2000;

let cachedClient: SupabaseClient | null = null;

function ensureClient(): SupabaseClient {
  if (!cachedClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing Supabase configuration');
    }
    cachedClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}

function normalizeString(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeString(entry);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function readBodyAsString(body: unknown): string | null {
  if (typeof body === 'string') {
    return body;
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8');
  }

  return null;
}

function parseBody(
  req: VercelRequest,
): { payload: Record<string, any> | null; invalid: boolean; rawText: string | null } {
  const contentTypeHeader = Array.isArray(req.headers['content-type'])
    ? req.headers['content-type'][0]
    : req.headers['content-type'];
  const contentType =
    typeof contentTypeHeader === 'string'
      ? contentTypeHeader.split(';')[0].trim().toLowerCase()
      : '';

  const body = req.body;

  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    return { payload: body as Record<string, any>, invalid: false, rawText: null };
  }

  const rawBody = readBodyAsString(body) ?? readBodyAsString((req as any).rawBody);
  if (!rawBody) {
    return { payload: null, invalid: false, rawText: null };
  }

  const shouldParse = !contentType || contentType === 'application/json' || contentType === 'text/plain';
  if (!shouldParse) {
    return { payload: null, invalid: false, rawText: rawBody };
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object') {
      return { payload: parsed as Record<string, any>, invalid: false, rawText: rawBody };
    }
    return { payload: null, invalid: true, rawText: rawBody };
  } catch {
    return { payload: null, invalid: true, rawText: rawBody };
  }
}

async function isDuplicateEvent(
  client: SupabaseClient,
  rid: string | null,
  eventName: string,
): Promise<boolean> {
  if (!rid) {
    return false;
  }

  const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  try {
    const { data, error } = await client
      .from('track_events')
      .select('diag_id')
      .eq('rid', rid)
      .eq('event_name', eventName)
      .gte('created_at', windowStart)
      .limit(1);

    if (error) {
      throw error;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    logApiError('track.dedupe_failed', { error });
    return false;
  }
}

function buildInsertPayload(
  eventName: string,
  rid: string | null,
  payload: Record<string, any> | null,
  req: VercelRequest,
  decision: CorsDecision,
  diagId: string,
) {
  const designSlug = payload ? normalizeString(payload.design_slug) : null;
  const cta = payload ? normalizeString(payload.cta) : null;
  const userAgent = normalizeString(req.headers['user-agent']);
  const referer = normalizeString(req.headers.referer || req.headers['referrer']);
  const origin = decision.allowed && decision.allowedOrigin ? decision.allowedOrigin : null;

  return {
    event_name: eventName,
    rid,
    design_slug: designSlug,
    cta,
    user_agent: userAgent,
    referer,
    origin,
    diag_id: diagId,
    created_at: new Date().toISOString(),
  };
}

function respondEcho(
  res: VercelResponse,
  diagId: string,
  decision: CorsDecision,
  accepted: boolean,
  eventName: string | null,
  rid: string | null,
) {
  const origin = decision.allowedOrigin ?? decision.requestedOrigin ?? null;
  res.status(200).json({ ok: true, diagId, origin, accepted, event_name: eventName, rid });
}

function logTrack(diagId: string, payload: Record<string, unknown>) {
  try {
    console.log('[track]', diagId, payload);
  } catch {}
}

function logCors(diagId: string, decision: CorsDecision) {
  try {
    console.log('[track:cors]', diagId, {
      origin: decision.requestedOrigin,
      allowed: decision.allowed,
    });
  } catch {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = createDiagId();
  res.setHeader('X-Track-Diag-Id', diagId);

  const originHeader =
    typeof req.headers.origin === 'string' && req.headers.origin.trim().length > 0
      ? req.headers.origin
      : undefined;
  const allowedOrigins = getAllowedOriginsFromEnv();
  const corsDecision = resolveCorsDecision(originHeader, allowedOrigins);

  if (corsDecision.allowed && corsDecision.allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsDecision.allowedOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');

  logCors(diagId, corsDecision);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    logTrack(diagId, {
      reason: 'method_not_allowed',
      origin: corsDecision.requestedOrigin,
    });
    res.status(405).json({ ok: false, diagId, error: 'method_not_allowed' });
    return;
  }

  const echoMode = String(req.query?.echo ?? '') === '1';

  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    logTrack(diagId, {
      reason: 'cors_denied',
      origin: corsDecision.requestedOrigin,
    });
    if (echoMode) {
      respondEcho(res, diagId, corsDecision, false, null, null);
    } else {
      res.status(204).end();
    }
    return;
  }

  if (process.env.TRACKING_ENABLED === '0') {
    logTrack(diagId, {
      reason: 'tracking_disabled',
      origin: corsDecision.requestedOrigin,
    });
    if (echoMode) {
      respondEcho(res, diagId, corsDecision, false, null, null);
    } else {
      res.status(204).end();
    }
    return;
  }

  const { payload, invalid } = parseBody(req);
  const eventName = normalizeString(payload?.event_name);
  const rid = normalizeString(payload?.rid);

  if (invalid || !payload) {
    logTrack(diagId, {
      reason: invalid ? 'invalid_payload' : 'missing_payload',
      origin: corsDecision.requestedOrigin,
      event_name: eventName,
      rid,
    });
    if (echoMode) {
      respondEcho(res, diagId, corsDecision, false, eventName, rid);
    } else {
      res.status(204).end();
    }
    return;
  }

  if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
    logTrack(diagId, {
      reason: 'event_not_allowed',
      origin: corsDecision.requestedOrigin,
      event_name: eventName,
      rid,
    });
    if (echoMode) {
      respondEcho(res, diagId, corsDecision, false, eventName, rid);
    } else {
      res.status(204).end();
    }
    return;
  }

  if (echoMode) {
    respondEcho(res, diagId, corsDecision, true, eventName, rid);
    return;
  }

  let client: SupabaseClient;
  try {
    client = ensureClient();
  } catch (error) {
    logApiError('track.supabase_config_missing', { diagId, error });
    res.status(204).end();
    return;
  }

  const duplicate = await isDuplicateEvent(client, rid, eventName);
  if (duplicate) {
    logTrack(diagId, {
      reason: 'dedupe',
      origin: corsDecision.allowedOrigin,
      event_name: eventName,
      rid,
    });
    res.status(204).end();
    return;
  }

  const insertPayload = buildInsertPayload(eventName, rid, payload, req, corsDecision, diagId);

  try {
    const { error } = await client.from('track_events').insert(insertPayload);
    if (error) {
      throw error;
    }
    logTrack(diagId, {
      reason: 'inserted',
      origin: corsDecision.allowedOrigin,
      event_name: eventName,
      rid,
    });
  } catch (error) {
    logApiError('track.insert_failed', { diagId, error });
  }

  res.status(204).end();
}
