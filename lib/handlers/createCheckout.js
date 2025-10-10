import { z } from 'zod';
import { getPublicStorefrontBase } from '../publicStorefront.js';
import { getShopifySalesChannel, shopifyStorefrontGraphQL } from '../shopify.js';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import logger from '../_lib/logger.js';
import { applyStubCors, buildStubRequestId, handleStubOptions, isStubEnabled, resolveFrontOrigin } from '../_lib/stubHelpers.js';

function normalizeVariantId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    email: z.string().email().optional(),
    mode: z.enum(['checkout', 'cart', 'private']).optional(),
    note: z.string().optional(),
    noteAttributes: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
        }),
      )
      .optional(),
    discount: z.string().optional(),
    rid: z.string().optional(),
    design_slug: z.string().optional(),
    designSlug: z.string().optional(),
  })
  .passthrough();

function parseVariantNumericId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

function buildVariantGid(value) {
  const numeric = parseVariantNumericId(value);
  if (!numeric) return '';
  return `gid://shopify/ProductVariant/${numeric}`;
}

function normalizeCartNote(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.slice(0, 1000);
}

function collectAttributes({ noteAttributes, email }) {
  const normalized = [];
  const seen = new Set();
  const push = (key, value) => {
    if (!key || typeof key !== 'string') return;
    const trimmedKey = key.trim();
    if (!trimmedKey) return;
    const dedupeKey = trimmedKey.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const stringValue = value == null ? '' : String(value).trim();
    normalized.push({ key: trimmedKey.slice(0, 255), value: stringValue.slice(0, 255) });
  };
  push('mgm_source', 'editor');
  if (email) {
    push('customer_email', email);
  }
  if (Array.isArray(noteAttributes)) {
    for (const attr of noteAttributes) {
      if (!attr || typeof attr !== 'object') continue;
      const nameRaw = typeof attr.name === 'string' ? attr.name : typeof attr.key === 'string' ? attr.key : '';
      const valueRaw = typeof attr.value === 'string' ? attr.value : '';
      push(nameRaw, valueRaw);
      if (normalized.length >= 30) break;
    }
  }
  return normalized;
}

function normalizeAttributeValue(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 255);
}

function pickHeaderValue(headers, name) {
  if (!headers || typeof name !== 'string') return '';
  const lower = name.toLowerCase();
  const upper = name.toUpperCase();
  const raw = headers[name] ?? headers[lower] ?? headers[upper];
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' ? raw[0] : '';
  }
  return typeof raw === 'string' ? raw : '';
}

function extractTrackingFields({ body, headers }) {
  const ridValue =
    (typeof body?.rid === 'string' && body.rid) ||
    (typeof body?.rid === 'number' ? String(body.rid) : '') ||
    pickHeaderValue(headers, 'x-rid');
  const designSlugValue =
    (typeof body?.design_slug === 'string' && body.design_slug) ||
    (typeof body?.designSlug === 'string' && body.designSlug) ||
    pickHeaderValue(headers, 'x-design-slug');

  const rid = normalizeAttributeValue(ridValue);
  const designSlug = normalizeAttributeValue(designSlugValue);
  return { rid, designSlug };
}

const CART_CREATE_MUTATION = `
  mutation CartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function createStorefrontCheckout({
  variantId,
  quantity,
  email,
  note,
  noteAttributes,
  buyerIp,
  discount,
  rid,
  designSlug,
}) {
  const variantGid = buildVariantGid(variantId);
  if (!variantGid) {
    return { ok: false, reason: 'invalid_variant' };
  }

  const lineItem = {
    merchandiseId: variantGid,
    quantity,
  };
  const customAttributes = [];
  if (rid) customAttributes.push({ key: 'rid', value: rid });
  if (designSlug) customAttributes.push({ key: 'design_slug', value: designSlug });
  if (customAttributes.length) {
    lineItem.attributes = customAttributes;
  }

  const input = {
    lines: [lineItem],
  };

  const attributes = collectAttributes({ noteAttributes, email });
  if (attributes.length) {
    input.attributes = attributes;
  }

  const noteValue = normalizeCartNote(note);
  if (noteValue) {
    input.note = noteValue;
  }

  let response;
  let text;
  try {
    response = await shopifyStorefrontGraphQL(CART_CREATE_MUTATION, { input }, buyerIp ? { buyerIp } : {});
    text = await response.text();
  } catch (err) {
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return { ok: false, reason: 'storefront_env_missing', missing: err.missing };
    }
    return { ok: false, reason: 'storefront_request_failed', error: err };
  }

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    return { ok: false, reason: 'storefront_http_error', status: response.status, body: text?.slice(0, 2000) };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'invalid_response' };
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'graphql_errors', errors: json.errors };
  }
  const payload = json?.data?.cartCreate;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_response' };
  }
  const userErrors = Array.isArray(payload.userErrors)
    ? payload.userErrors
        .map((entry) => (entry && typeof entry.message === 'string' ? entry.message.trim() : ''))
        .filter(Boolean)
    : [];
  if (userErrors.length) {
    return { ok: false, reason: 'user_errors', userErrors };
  }
  const checkoutUrl = typeof payload?.cart?.checkoutUrl === 'string' ? payload.cart.checkoutUrl : '';
  if (!checkoutUrl) {
    return { ok: false, reason: 'missing_checkout_url' };
  }

  let finalUrl = checkoutUrl;
  if (discount) {
    try {
      const checkoutUrlObj = new URL(finalUrl);
      checkoutUrlObj.searchParams.set('discount', discount);
      finalUrl = checkoutUrlObj.toString();
    } catch {}
  }
  if (email) {
    try {
      const checkoutUrlObj = new URL(finalUrl);
      checkoutUrlObj.searchParams.set('checkout[email]', email);
      finalUrl = checkoutUrlObj.toString();
    } catch {}
  }

  return { ok: true, url: finalUrl };
}

export default async function createCheckout(req, res) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  if (handleStubOptions(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }

  if (isStubEnabled()) {
    applyStubCors(res);
    const rid = buildStubRequestId();
    const origin = resolveFrontOrigin();
    const checkoutUrl = `${origin}/mockup?rid=${rid}&step=checkout&from=create-checkout`;
    return res.status(200).json({
      ok: true,
      stub: true,
      url: checkoutUrl,
      checkoutUrl,
      message: null,
      missing: [],
    });
  }

  try {
    const body = await parseJsonBody(req).catch((err) => {
      if (err?.code === 'payload_too_large') {
        if (typeof res.status === 'function') res.status(413);
        else res.statusCode = 413;
        throw new Error('payload_too_large');
      }
      if (err?.code === 'invalid_json') {
        if (typeof res.status === 'function') res.status(400);
        else res.statusCode = 400;
        throw new Error('invalid_json');
      }
      throw err;
    });
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'invalid_body', issues: parsed.error.flatten().fieldErrors });
    }
    const { variantId, variantGid, quantity, email, mode, note, noteAttributes, discount } = parsed.data;
    const { rid, designSlug } = extractTrackingFields({ body, headers: req.headers || {} });
    const diagId = req?.mgmDiagId || null;
    try {
      logger.info?.('create_checkout_attach_rid', {
        diagId,
        step: 'attach_rid',
        rid: rid || null,
        design_slug: designSlug || null,
      });
    } catch {}
    const normalizedVariantId = normalizeVariantId(variantId ?? variantGid);
    if (!normalizedVariantId) return res.status(400).json({ ok: false, error: 'missing_variant' });
    const qtyRaw = Number(quantity);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(Math.floor(qtyRaw), 99) : 1;
    const base = getPublicStorefrontBase();
    if (!base) return res.status(500).json({ ok: false, error: 'missing_store_domain' });

    const normalizedEmail = typeof email === 'string' ? email.trim() : '';
    const normalizedDiscount = typeof discount === 'string' ? discount.trim() : '';

    if (mode === 'private') {
      if (!normalizedEmail) {
        return res.status(400).json({ ok: false, error: 'missing_email' });
      }
      const buyerIp = getClientIp(req);
      const storefrontCheckout = await createStorefrontCheckout({
        variantId: normalizedVariantId,
        quantity: qty,
        email: normalizedEmail,
        note,
        noteAttributes,
        buyerIp,
        discount: normalizedDiscount,
        rid,
        designSlug,
      });
      if (!storefrontCheckout?.ok || !storefrontCheckout?.url) {
        if (storefrontCheckout?.missing) {
          return res.status(400).json({ ok: false, error: 'shopify_env_missing', missing: storefrontCheckout.missing });
        }
        if (storefrontCheckout?.reason === 'user_errors') {
          return res.status(400).json({ ok: false, error: 'storefront_user_errors', userErrors: storefrontCheckout.userErrors });
        }
        if (storefrontCheckout?.reason === 'graphql_errors') {
          return res.status(502).json({ ok: false, error: 'storefront_graphql_errors', detail: storefrontCheckout.errors });
        }
        if (storefrontCheckout?.reason === 'storefront_http_error') {
          return res.status(502).json({
            ok: false,
            error: 'storefront_http_error',
            status: storefrontCheckout.status,
            detail: storefrontCheckout.body,
          });
        }
        return res.status(502).json({
          ok: false,
          error: storefrontCheckout?.reason || 'storefront_checkout_failed',
          detail: storefrontCheckout?.error,
        });
      }
      return res.status(200).json({ ok: true, url: storefrontCheckout.url });
    }

    let checkoutUrl;
    try {
      checkoutUrl = new URL(`/cart/${normalizedVariantId}:${qty}`, base);
    } catch (err) {
      logger.error('create_checkout_url_error', err);
      return res.status(500).json({ ok: false, error: 'invalid_store_domain' });
    }

    const checkoutChannel = getShopifySalesChannel('checkout');
    if (checkoutChannel) checkoutUrl.searchParams.set('channel', checkoutChannel);
    if (normalizedEmail) {
      checkoutUrl.searchParams.set('checkout[email]', normalizedEmail);
    }
    if (normalizedDiscount) {
      checkoutUrl.searchParams.set('discount', normalizedDiscount);
    }
    const checkoutReturnToRaw = typeof process.env.SHOPIFY_CHECKOUT_RETURN_TO === 'string'
      ? process.env.SHOPIFY_CHECKOUT_RETURN_TO.trim()
      : '';
    checkoutUrl.searchParams.set('return_to', checkoutReturnToRaw || '/checkout');

    return res.status(200).json({ ok: true, url: checkoutUrl.toString() });
  } catch (e) {
    if (res.statusCode === 413) {
      return res.json({ ok: false, error: 'payload_too_large' });
    }
    if (res.statusCode === 400 && String(e?.message).includes('invalid_json')) {
      return res.json({ ok: false, error: 'invalid_json' });
    }
    logger.error('create_checkout_error', e);
    return res.status(500).json({ ok: false, error: 'create_checkout_failed' });
  }
}
