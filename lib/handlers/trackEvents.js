import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import logger from '../_lib/logger.js';

const ALLOWED_EVENTS = new Set([
  'mockup_view',
  'view_purchase_options',
  'cta_click_public',
  'cta_click_private',
  'cta_click_cart',
  'purchase_completed',
  'page_view',
  'site_visit',
  'home_image_uploaded',
  'home_step_edit',
  'home_step_review',
  'continue_design',
  'home_config_open',
  'home_tools_open',
  'home_add_to_cart',
  'home_add_private_cart',
  'home_return_editor',
  'home_restart',
  'click_replace_image',
]);

function normalizeString(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeString(entry);
      if (normalized) return normalized;
    }
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readBodyAsString(body) {
  if (typeof body === 'string') return body;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8');
  }
  return null;
}

function parseFormUrlencoded(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return null;
  const params = new URLSearchParams(rawBody);
  const result = {};
  for (const [key, value] of params.entries()) {
    if (key) result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}

function parsePayload(req) {
  const contentTypeHeader = req.headers['content-type'];
  const contentType = typeof contentTypeHeader === 'string'
    ? contentTypeHeader.split(';')[0].trim().toLowerCase()
    : '';

  const body = req.body;

  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    return { payload: body, invalid: false };
  }

  const rawBody = readBodyAsString(body) ?? readBodyAsString(req.rawBody);
  if (!rawBody) {
    return { payload: null, invalid: false };
  }

  if (contentType === 'application/x-www-form-urlencoded' || contentType === 'text/plain') {
    const form = parseFormUrlencoded(rawBody);
    if (form) return { payload: form, invalid: false };
  }

  if (!contentType || contentType === 'application/json' || contentType === 'text/plain') {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed === 'object') {
        return { payload: parsed, invalid: false };
      }
    } catch {
      const form = parseFormUrlencoded(rawBody);
      if (form) return { payload: form, invalid: false };
    }
  }

  const formFallback = parseFormUrlencoded(rawBody);
  if (formFallback) return { payload: formFallback, invalid: false };

  return { payload: null, invalid: true };
}

function normalizeEvent(payload) {
  if (!payload || typeof payload !== 'object') {
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
  const designSlug = normalizeString(payload.design_slug) || normalizeString(payload.designSlug);
  const productHandle =
    normalizeString(payload.product_handle)
    || normalizeString(payload.productHandle)
    || normalizeString(payload.product_handle_slug);

  let ctaType =
    normalizeString(payload.cta_type)
    || normalizeString(payload.ctaType)
    || normalizeString(payload.cta);

  if (!ctaType && eventName?.startsWith('cta_click_')) {
    ctaType = eventName.replace('cta_click_', '');
  }

  const extra = {};
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
        Object.assign(extra, JSON.parse(payload.extra));
      } catch {
        extra.extra = payload.extra;
      }
    } else if (typeof payload.extra === 'object') {
      Object.assign(extra, payload.extra);
    }
  }

  return {
    eventName,
    rid,
    ctaType,
    designSlug,
    productHandle,
    extra: Object.keys(extra).length ? extra : null,
  };
}

function buildInsertPayload(normalized, req, corsDecision, diagId) {
  const userAgent = normalizeString(req.headers['user-agent']);
  const referer = normalizeString(req.headers.referer || req.headers.referrer);
  const origin = corsDecision.allowed && corsDecision.allowedOrigin
    ? corsDecision.allowedOrigin
    : null;
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = normalizeString(typeof rawIp === 'string' ? rawIp.split(',')[0] : null);

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
    created_at: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export async function trackEvents(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Track-Diag-Id', diagId);

  const echoMode = String(req.query?.echo ?? '') === '1';
  const { payload, invalid } = parsePayload(req);
  const normalized = normalizeEvent(payload);
  const { eventName, rid } = normalized;

  if (invalid || !payload) {
    if (echoMode) {
      sendJson(res, 200, {
        ok: true,
        diagId,
        accepted: false,
        reason: invalid ? 'invalid_payload' : 'missing_payload',
        event_name: eventName,
        rid,
      });
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
    if (echoMode) {
      sendJson(res, 200, {
        ok: true,
        diagId,
        accepted: false,
        reason: !eventName ? 'missing_event' : 'event_not_allowed',
        event_name: eventName,
        rid,
      });
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!rid) {
    if (echoMode) {
      sendJson(res, 200, {
        ok: true,
        diagId,
        accepted: false,
        reason: 'missing_rid',
        event_name: eventName,
        rid: null,
      });
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    logger.error?.('track_init_supabase_failed', { diagId, error: error?.message || error });
    if (echoMode) {
      sendJson(res, 200, {
        ok: true,
        diagId,
        accepted: false,
        reason: 'missing_env',
        event_name: eventName,
        rid,
      });
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  const corsOrigin = res.getHeader('Access-Control-Allow-Origin');
  const corsDecision = {
    allowed: true,
    allowedOrigin: typeof corsOrigin === 'string' ? corsOrigin : null,
  };

  const insertPayload = buildInsertPayload(normalized, req, corsDecision, diagId);

  let insertStatus = 'inserted';
  let insertError = null;

  try {
    const { error } = await supabase.from('track_events').insert(insertPayload);
    if (error) {
      if (error.code === '23505') {
        insertStatus = 'duplicate';
      } else {
        throw error;
      }
    }
  } catch (error) {
    insertStatus = 'failed';
    insertError = {
      code: error?.code || null,
      message: error?.message || String(error),
    };
    logger.error?.('track_insert_failed', { diagId, eventName, rid, error: insertError });
  }

  if (echoMode) {
    sendJson(res, 200, {
      ok: true,
      diagId,
      accepted: insertStatus !== 'failed',
      reason: insertStatus,
      event_name: eventName,
      rid,
      insert_error: insertError,
    });
    return;
  }

  res.statusCode = 204;
  res.end();
}

export default trackEvents;
