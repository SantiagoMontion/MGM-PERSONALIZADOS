import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDiagId, logApiError } from './_lib/diag.js';
import {
  applyCorsHeaders,
  ensureCors,
  handlePreflight,
  respondCorsDenied,
  type CorsDecision,
} from './_lib/cors.js';

const ALLOWED_EVENTS = new Set<string>([
  'mockup_view',
  'view_purchase_options',
  'cta_click_public',
  'cta_click_private',
  'cta_click_cart',
  'purchase_completed',
]);

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

function parseFormUrlencoded(rawBody: string | null): Record<string, any> | null {
  if (!rawBody) {
    return null;
  }

  const params = new URLSearchParams(rawBody);
  const result: Record<string, any> = {};
  for (const [key, value] of params.entries()) {
    if (!key) continue;
    result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}

function parseMultipartFormData(rawBody: string | null, contentType: string): Record<string, any> | null {
  if (!rawBody) {
    return null;
  }

  const boundaryMatch = contentType.match(/boundary=(.+)$/i);
  const boundary = boundaryMatch ? boundaryMatch[1] : null;
  if (!boundary) {
    return null;
  }

  const parts = rawBody.split(`--${boundary}`);
  const result: Record<string, any> = {};

  for (const part of parts) {
    if (!part || part === '--' || part === '--\r\n') continue;
    const [rawHeaders, ...bodyParts] = part.split('\r\n\r\n');
    if (!rawHeaders || !bodyParts.length) continue;
    const content = bodyParts.join('\r\n\r\n');
    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const value = content.replace(/\r?\n--$/, '').replace(/\r?\n$/, '');
    result[name] = value;
  }

  return Object.keys(result).length ? result : null;
}

function parseBody(
  req: VercelRequest,
): { payload: Record<string, any> | null; invalid: boolean; rawText: string | null; contentType: string } {
  const contentTypeHeader = Array.isArray(req.headers['content-type'])
    ? req.headers['content-type'][0]
    : req.headers['content-type'];
  const contentType =
    typeof contentTypeHeader === 'string'
      ? contentTypeHeader.split(';')[0].trim().toLowerCase()
      : '';

  const body = req.body;

  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    return { payload: body as Record<string, any>, invalid: false, rawText: null, contentType };
  }

  const rawBody = readBodyAsString(body) ?? readBodyAsString((req as any).rawBody);
  if (!rawBody) {
    return { payload: null, invalid: false, rawText: null, contentType };
  }

  if (contentType === 'application/x-www-form-urlencoded') {
    const parsed = parseFormUrlencoded(rawBody);
    if (parsed) {
      return { payload: parsed, invalid: false, rawText: rawBody, contentType };
    }
    return { payload: null, invalid: true, rawText: rawBody, contentType };
  }

  if (contentType.startsWith('multipart/form-data')) {
    const parsed = parseMultipartFormData(rawBody, contentTypeHeader as string);
    if (parsed) {
      return { payload: parsed, invalid: false, rawText: rawBody, contentType };
    }
    return { payload: null, invalid: true, rawText: rawBody, contentType };
  }

  const shouldParse = !contentType || contentType === 'application/json' || contentType === 'text/plain';
  if (!shouldParse) {
    return { payload: null, invalid: false, rawText: rawBody, contentType };
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object') {
      return { payload: parsed as Record<string, any>, invalid: false, rawText: rawBody, contentType };
    }
    return { payload: null, invalid: true, rawText: rawBody, contentType };
  } catch {
    return { payload: null, invalid: true, rawText: rawBody, contentType };
  }
}

type NormalizedEvent = {
  eventName: string | null;
  rid: string | null;
  ctaType: string | null;
  designSlug: string | null;
  productHandle: string | null;
  extra: Record<string, any> | null;
};

function normalizeEvent(payload: Record<string, any> | null): NormalizedEvent {
  if (!payload) {
    return {
      eventName: null,
      rid: null,
      ctaType: null,
      designSlug: null,
      productHandle: null,
      extra: null,
    };
  }

  const eventName =
    normalizeString(payload.event)
    || normalizeString(payload.event_name)
    || normalizeString(payload.eventName);
  const rid = normalizeString(payload.rid);
  const designSlug =
    normalizeString(payload.design_slug)
    || normalizeString(payload.designSlug);
  const productHandle =
    normalizeString(payload.product_handle)
    || normalizeString(payload.productHandle)
    || normalizeString(payload.product_handle_slug);
  let rawCtaType =
    normalizeString(payload.cta_type)
    || normalizeString(payload.ctaType)
    || normalizeString(payload.cta);

  if (!rawCtaType && eventName && eventName.startsWith('cta_click_')) {
    rawCtaType = eventName.replace('cta_click_', '');
  }

  const extra: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lowered = key.toLowerCase();
    if (
      lowered === 'event'
      || lowered === 'event_name'
      || lowered === 'eventname'
      || lowered === 'rid'
      || lowered === 'design_slug'
      || lowered === 'designslug'
      || lowered === 'cta'
      || lowered === 'cta_type'
      || lowered === 'ctatype'
      || lowered === 'product_handle'
      || lowered === 'producthandle'
      || lowered === 'product_handle_slug'
      || lowered === 'extra'
    ) {
      continue;
    }
    extra[key] = value;
  }

  if (payload.extra) {
    if (typeof payload.extra === 'string') {
      try {
        const parsed = JSON.parse(payload.extra);
        if (parsed && typeof parsed === 'object') {
          Object.assign(extra, parsed as Record<string, any>);
        }
      } catch {
        extra.extra = payload.extra;
      }
    } else if (typeof payload.extra === 'object') {
      Object.assign(extra, payload.extra);
    }
  }

  const normalizedExtra = Object.keys(extra).length ? extra : null;

  return {
    eventName,
    rid,
    ctaType: rawCtaType,
    designSlug,
    productHandle,
    extra: normalizedExtra,
  };
}

function buildInsertPayload(
  normalized: NormalizedEvent,
  req: VercelRequest,
  decision: CorsDecision,
  diagId: string,
) {
  const userAgent = normalizeString(req.headers['user-agent']);
  const referer = normalizeString(req.headers.referer || req.headers['referrer']);
  const origin = decision.allowed && decision.allowedOrigin ? decision.allowedOrigin : null;
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = normalizeString(rawIp?.split(',')[0]);
  const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();

  return {
    event_name: normalized.eventName,
    rid: normalized.rid,
    cta_type: normalized.ctaType,
    design_slug: normalized.designSlug,
    product_handle: normalized.productHandle,
    extra: normalized.extra,
    user_agent: userAgent,
    referer,
    origin,
    ip,
    diag_id: diagId,
    created_at: createdAt,
  };
}

function respondEcho(
  req: VercelRequest,
  res: VercelResponse,
  diagId: string,
  decision: CorsDecision,
  accepted: boolean,
  eventName: string | null,
  rid: string | null,
) {
  const origin = decision.allowedOrigin ?? decision.requestedOrigin ?? null;
  applyCorsHeaders(req, res, decision);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({ ok: true, diagId, origin, accepted, event_name: eventName, rid });
}

function respondIgnored(req: VercelRequest, res: VercelResponse, decision: CorsDecision) {
  applyCorsHeaders(req, res, decision);
  res.status(204).end();
}

function logTrack(
  diagId: string,
  payload: {
    event_name?: string | null;
    rid?: string | null;
    reason?: string;
    origin?: string | null;
  } = {},
) {
  try {
    const {
      event_name: eventName = null,
      rid = null,
      reason = undefined,
      origin = undefined,
    } = payload;
    const logPayload: Record<string, unknown> = { diagId, rid, event: eventName };
    if (reason) {
      logPayload.reason = reason;
    }
    if (origin) {
      logPayload.origin = origin;
    }
    console.log('[track]', logPayload);
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

  const corsDecision = ensureCors(req, res);

  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    logTrack(diagId, {
      reason: 'cors_denied',
      origin: corsDecision.requestedOrigin,
    });
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  logCors(diagId, corsDecision);

  if (req.method === 'OPTIONS') {
    handlePreflight(req, res, corsDecision);
    return;
  }

  if (req.method !== 'POST') {
    logTrack(diagId, {
      reason: 'method_not_allowed',
      origin: corsDecision.requestedOrigin,
    });
    applyCorsHeaders(req, res, corsDecision);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(405).json({ ok: false, diagId, error: 'method_not_allowed' });
    return;
  }

  const processRequest = async () => {
    const echoMode = String(req.query?.echo ?? '') === '1';

    const respondIgnoredOrEcho = (
      request: VercelRequest,
      accepted: boolean,
      eventNameValue: string | null,
      ridValue: string | null,
    ) => {
      if (echoMode) {
        respondEcho(request, res, diagId, corsDecision, accepted, eventNameValue, ridValue);
      } else {
        respondIgnored(request, res, corsDecision);
      }
    };

    if (process.env.TRACKING_ENABLED === '0') {
      logTrack(diagId, {
        reason: 'tracking_disabled',
        origin: corsDecision.requestedOrigin,
      });
      respondIgnoredOrEcho(req, false, null, null);
      return;
    }

    const { payload, invalid, rawText, contentType } = parseBody(req);
    const normalized = normalizeEvent(payload);
    let { eventName, rid } = normalized;

    if (!eventName && typeof rawText === 'string' && rawText.trim()) {
      const fallback = normalizeString(rawText);
      if (fallback && ALLOWED_EVENTS.has(fallback)) {
        eventName = fallback;
      }
    }

    if (!eventName && contentType === 'text/plain') {
      eventName = normalizeString(payload?.event);
    }

    if (!eventName && payload && typeof payload === 'object') {
      const eventKey = Object.keys(payload).find((key) => key.toLowerCase() === 'event');
      if (eventKey) {
        eventName = normalizeString((payload as Record<string, any>)[eventKey]);
      }
    }

    if (!rid && payload && typeof payload === 'object') {
      const ridKey = Object.keys(payload).find((key) => key.toLowerCase() === 'request_id');
      if (ridKey) {
        rid = normalizeString((payload as Record<string, any>)[ridKey]);
      }
    }

    normalized.eventName = eventName;
    normalized.rid = rid;

    if (invalid || !payload) {
      logTrack(diagId, {
        reason: invalid ? 'invalid_payload' : 'missing_payload',
        origin: corsDecision.requestedOrigin,
        event_name: eventName,
        rid,
      });
      respondIgnoredOrEcho(req, false, eventName ?? null, rid ?? null);
      return;
    }

    if (!eventName) {
      respondIgnoredOrEcho(req, false, null, rid ?? null);
      return;
    }

    if (!ALLOWED_EVENTS.has(eventName)) {
      logTrack(diagId, {
        reason: 'event_not_allowed',
        origin: corsDecision.requestedOrigin,
        event_name: eventName,
        rid,
      });
      respondIgnoredOrEcho(req, false, eventName, rid ?? null);
      return;
    }

    if (!rid) {
      respondIgnoredOrEcho(req, false, eventName, null);
      return;
    }

    if (echoMode) {
      respondEcho(req, res, diagId, corsDecision, true, eventName, rid);
      return;
    }

    let client: SupabaseClient;
    try {
      client = ensureClient();
    } catch (error) {
      logApiError('track.supabase_config_missing', { diagId, error });
      respondIgnoredOrEcho(req, false, eventName, rid);
      return;
    }

    const insertPayload = buildInsertPayload(normalized, req, corsDecision, diagId);

    try {
      const { error } = await client.from('track_events').insert(insertPayload);
      if (error && error.code !== '23505') {
        throw error;
      }
      if (error && error.code === '23505') {
        logTrack(diagId, {
          reason: 'duplicate',
          origin: corsDecision.allowedOrigin,
          event_name: eventName,
          rid,
        });
      } else {
        logTrack(diagId, {
          reason: 'inserted',
          origin: corsDecision.allowedOrigin,
          event_name: eventName,
          rid,
        });
      }
    } catch (error) {
      const errorName = (error as any)?.name;
      if (errorName === 'AbortError' || errorName === 'TypeError') {
        respondIgnoredOrEcho(req, false, eventName, rid);
        return;
      }
      logApiError('track.insert_failed', { diagId, error });
    }

    if (!res.headersSent) {
      applyCorsHeaders(req, res, corsDecision);
      res.status(204).end();
    }
  };

  try {
    await processRequest();
  } catch (error) {
    const errorName = (error as any)?.name;
    if (errorName === 'AbortError' || errorName === 'TypeError') {
      if (!res.headersSent) {
        respondIgnored(req, res, corsDecision);
      }
      return;
    }
    logApiError('track.unhandled_error', { diagId, error });
    if (!res.headersSent) {
      applyCorsHeaders(req, res, corsDecision);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(500).json({ ok: false, diagId, error: 'handler_error' });
    }
  }
}
