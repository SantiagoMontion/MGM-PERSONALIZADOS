import crypto from 'node:crypto';
import { readRequestBody } from '../_lib/http.js';
import logger from '../_lib/logger.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

const ALLOWED_TOPICS = new Set(['orders/create', 'orders/paid']);
const HMAC_HEADER = 'x-shopify-hmac-sha256';

function getHeaderValue(req, name) {
  const header = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(header)) return header[0];
  return header;
}

function toTrimmedString(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return null;
}

function findAttribute(collection, key) {
  if (!Array.isArray(collection)) return null;
  const target = String(key || '').toLowerCase();
  for (const entry of collection) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.toLowerCase() : '';
    if (name === target) {
      const value = 'value' in entry ? entry.value : undefined;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
  }
  return null;
}

function findInLineItemProperties(lineItems, key) {
  if (!Array.isArray(lineItems)) return null;
  for (const item of lineItems) {
    if (!item || typeof item !== 'object') continue;
    const match = findAttribute(item.properties, key);
    if (match) return match;
  }
  return null;
}

function findInCustomAttributes(collection, key) {
  if (!Array.isArray(collection)) return null;
  const target = String(key || '').toLowerCase();
  for (const entry of collection) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.key === 'string' ? entry.key.toLowerCase() : typeof entry.name === 'string' ? entry.name.toLowerCase() : '';
    if (name === target) {
      const value = 'value' in entry ? entry.value : undefined;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
  }
  return null;
}

function extractRid(order) {
  const fromLineItem = findInLineItemProperties(order?.line_items, 'rid');
  if (fromLineItem) return fromLineItem;

  const fromNotes = findAttribute(order?.note_attributes, 'rid');
  if (fromNotes) return fromNotes;

  const fromCustomAttrs = findInCustomAttributes(order?.customAttributes || order?.custom_attributes, 'rid')
    || findInCustomAttributes(order?.checkout?.customAttributes, 'rid');
  if (fromCustomAttrs) return fromCustomAttrs;

  const note = typeof order?.note === 'string' ? order.note : '';
  if (note) {
    const match = note.match(/rid=([A-Za-z0-9\-_]+)/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function extractDesignSlug(order) {
  const fromLineItem = findInLineItemProperties(order?.line_items, 'design_slug');
  if (fromLineItem) return fromLineItem;
  return findAttribute(order?.note_attributes, 'design_slug');
}

function extractProductHandle(order) {
  const fromLineItem = findInLineItemProperties(order?.line_items, 'product_handle');
  if (fromLineItem) return fromLineItem;
  const fromNotes = findAttribute(order?.note_attributes, 'product_handle');
  if (fromNotes) return fromNotes;
  const firstLineItem = Array.isArray(order?.line_items) && order.line_items.length ? order.line_items[0] : null;
  if (firstLineItem && typeof firstLineItem.handle === 'string' && firstLineItem.handle.trim()) {
    return firstLineItem.handle.trim();
  }
  const fromCustomAttrs = findInCustomAttributes(order?.customAttributes || order?.custom_attributes, 'product_handle')
    || findInCustomAttributes(order?.checkout?.customAttributes, 'product_handle');
  if (fromCustomAttrs) return fromCustomAttrs;
  return null;
}

function safeCompare(expected, received) {
  const expectedBuf = Buffer.from(expected || '', 'utf8');
  const receivedBuf = Buffer.from(received || '', 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export default async function shopifyWebhook(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, diag_id: diagId, error: 'missing_webhook_secret' });
  }

  let rawBody;
  try {
    rawBody = await readRequestBody(req, { limit: 512 * 1024 });
  } catch (err) {
    if (err?.code === 'payload_too_large') {
      logger.error('shopify-webhook payload_too_large', { diagId });
    } else {
      logger.error('shopify-webhook read_error', { diagId, err });
    }
    res.status(200).json({ ok: true });
    return;
  }

  const signatureHeader = getHeaderValue(req, HMAC_HEADER);
  const provided = signatureHeader ? String(signatureHeader) : '';
  if (!provided) {
    logger.error('shopify-webhook missing_signature', { diagId });
    res.status(401).end();
    return;
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  if (!safeCompare(digest, provided)) {
    logger.error('shopify-webhook invalid_signature', { diagId });
    res.status(401).end();
    return;
  }

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    logger.error('shopify-webhook json_error', { diagId, err: err?.message || err });
    res.status(200).json({ ok: true });
    return;
  }

  const topic = getHeaderValue(req, 'x-shopify-topic') || null;
  const normalizedTopic = String(topic || '').toLowerCase();
  const orderId = payload?.id;
  const orderIdString = orderId == null ? null : String(orderId);
  const rid = extractRid(payload);
  const designSlug = extractDesignSlug(payload);
  const productHandle = extractProductHandle(payload);

  logger.info('shopify-webhook received', {
    diagId,
    topic,
    orderId: orderIdString,
    ridFound: Boolean(rid),
  });

  if (!ALLOWED_TOPICS.has(normalizedTopic)) {
    res.status(200).json({ ok: true });
    return;
  }

  const shopDomain = getHeaderValue(req, 'x-shopify-shop-domain') || null;

  if (!orderIdString) {
    logger.warn('shopify-webhook missing_order_id', { diagId, topic });
    res.status(200).json({ ok: true });
    return;
  }
  const amount = toNumber(payload?.total_price);
  const currency = toTrimmedString(payload?.currency);
  const lineItemsCount = Array.isArray(payload?.line_items) ? payload.line_items.length : 0;
  const details = {
    topic,
    line_items_count: lineItemsCount,
    email: toTrimmedString(payload?.email),
    financial_status: toTrimmedString(payload?.financial_status),
  };

  try {
    const client = getSupabaseAdmin();
    const { data: existing, error: selectError } = await client
      .from('events')
      .select('id')
      .eq('event_name', 'purchase_completed')
      .eq('order_id', orderIdString)
      .limit(1);

    if (selectError) {
      throw selectError;
    }

    if (!Array.isArray(existing) || existing.length === 0) {
      const userAgentHeader = getHeaderValue(req, 'user-agent');
      const userAgent = userAgentHeader ? String(userAgentHeader) : 'shopify-webhook';
      const insertPayload = {
        event_name: 'purchase_completed',
        rid,
        design_slug: designSlug,
        order_id: orderIdString,
        amount,
        currency,
        origin: shopDomain ? String(shopDomain) : null,
        user_agent: userAgent,
        referer: '',
        details,
      };

      const { error: insertError } = await client.from('events').insert(insertPayload);
      if (insertError) {
        throw insertError;
      }

      try {
        const trackInsert = {
          event_name: 'purchase_completed',
          rid,
          design_slug: designSlug,
          product_handle: productHandle,
          origin: shopDomain ? String(shopDomain) : null,
          user_agent: userAgent,
          referer: '',
          ip:
            typeof req.headers['x-forwarded-for'] === 'string'
              ? req.headers['x-forwarded-for'].split(',')[0].trim()
              : null,
          diag_id: diagId,
          created_at: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
          extra: {
            order_id: orderIdString,
            topic,
            amount,
            currency,
            line_items_count: lineItemsCount,
            product_handle: productHandle,
          },
        };
        const { error: trackError } = await client.from('track_events').insert(trackInsert);
        if (trackError && trackError.code !== '23505') {
          throw trackError;
        }
      } catch (trackErr) {
        logger.warn('shopify-webhook track_events_insert_failed', {
          diagId,
          topic,
          orderId: orderIdString,
          ridFound: Boolean(rid),
          err: trackErr,
        });
      }
    }
  } catch (err) {
    logger.error('shopify-webhook supabase_error', {
      diagId,
      topic,
      orderId: orderIdString,
      ridFound: Boolean(rid),
      err,
    });
    res.status(200).json({ ok: true });
    return;
  }

  logger.info('shopify-webhook processed', {
    diagId,
    topic,
    orderId: orderIdString,
    ridFound: Boolean(rid),
  });

  try {
    console.log('[webhook]', { diagId, rid: rid || null });
  } catch {}

  res.status(200).json({ ok: true });
}

