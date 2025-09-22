import { z } from 'zod';
import { getPublicStorefrontBase } from '../publicStorefront.js';
import { getShopifySalesChannel, shopifyStorefrontGraphQL } from '../shopify.js';
import { parseJsonBody, getClientIp } from '../_lib/http.js';

function normalizeVariantId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

function ensureVariantGid(preferred, fallback, numericId) {
  const candidates = [preferred, fallback];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = String(candidate).trim();
    if (raw.startsWith('gid://')) return raw;
  }
  if (numericId) {
    return `gid://shopify/ProductVariant/${numericId}`;
  }
  return '';
}

function sanitizeReturnTarget(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || /checkout/i.test(trimmed)) return '';
  return trimmed;
}

function normalizeAbsolute(value, base) {
  const sanitized = sanitizeReturnTarget(value);
  if (!sanitized) return '';
  if (/^https?:\/\//i.test(sanitized)) return sanitized;
  if (!base) return sanitized;
  try {
    const url = new URL(sanitized, base);
    return url.toString();
  } catch {
    return sanitized;
  }
}

function normalizeAttributeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const keyRaw = typeof entry.key === 'string' ? entry.key : typeof entry.name === 'string' ? entry.name : '';
  const key = String(keyRaw || '').trim();
  if (!key) return null;
  const valueRaw = entry.value ?? entry.val ?? entry.content ?? '';
  const value = String(valueRaw ?? '').trim();
  return {
    key: key.slice(0, 255),
    value: value.slice(0, 255),
  };
}

function collectCustomAttributes(input) {
  const out = [];
  if (Array.isArray(input)) {
    for (const entry of input) {
      const normalized = normalizeAttributeEntry(entry);
      if (normalized) out.push(normalized);
      if (out.length >= 20) break;
    }
    return out;
  }
  if (input && typeof input === 'object') {
    const entries = Object.entries(input);
    for (const [key, value] of entries) {
      const normalized = normalizeAttributeEntry({ key, value });
      if (normalized) out.push(normalized);
      if (out.length >= 20) break;
    }
  }
  return out;
}

function mergeAttributes(custom = []) {
  const seen = new Set();
  const result = [];
  const push = (key, value) => {
    const rawKey = typeof key === 'string' ? key.trim() : '';
    if (!rawKey) return;
    const normKey = rawKey.slice(0, 255);
    const dedupeKey = normKey.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const rawValue = value == null ? '' : String(value);
    result.push({ key: normKey, value: rawValue.slice(0, 255) });
  };
  push('mgm_source', 'editor');
  for (const attr of custom) {
    push(attr.key, attr.value);
    if (result.length >= 30) break;
  }
  return result;
}

function normalizeCartNote(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.slice(0, 1000);
}

function buildLegacyCartPayload(base, variantId, qty) {
  const buildUrl = (path) => {
    try {
      return new URL(path, base);
    } catch (err) {
      try { console.error('create_cart_link_url_error', err); } catch {}
      return null;
    }
  };

  const cartAddUrl = buildUrl('/cart/add');
  if (!cartAddUrl) return null;
  cartAddUrl.searchParams.set('id', variantId);
  cartAddUrl.searchParams.set('quantity', String(qty));
  const cartChannel = getShopifySalesChannel('cart');
  if (cartChannel) cartAddUrl.searchParams.set('channel', cartChannel);

  const homeUrl = buildUrl('/');
  const cartPlainUrl = buildUrl('/cart');
  const cartPlainString = cartPlainUrl ? cartPlainUrl.toString() : '';
  const checkoutPlainUrl = buildUrl('/checkout');

  let mgmHome = '';
  try {
    const baseUrl = new URL(base);
    if (/mgmgamers/i.test(baseUrl.hostname)) {
      mgmHome = normalizeAbsolute('https://www.mgmgamers.store/', base);
    }
  } catch {
    mgmHome = normalizeAbsolute('https://www.mgmgamers.store/', base);
  }

  const mgmCart = mgmHome
    ? normalizeAbsolute(`${mgmHome.replace(/\/$/, '')}/cart`, base)
    : '';

  const candidates = [
    normalizeAbsolute(process.env.SHOPIFY_CART_RETURN_TO, base),
    mgmCart,
    cartPlainString,
    normalizeAbsolute(process.env.SHOPIFY_HOME_URL, base),
    mgmHome,
    homeUrl ? homeUrl.toString() : '',
    (() => {
      try {
        return new URL('/', base).toString();
      } catch {
        return '';
      }
    })(),
    '/',
  ];
  const returnTarget = candidates.find((value) => sanitizeReturnTarget(value)) || '/';
  if (returnTarget) {
    cartAddUrl.searchParams.set('return_to', returnTarget);
  }

  const checkoutNowUrl = buildUrl(`/cart/${variantId}:${qty}`);
  if (checkoutNowUrl) {
    const checkoutChannel = getShopifySalesChannel('checkout');
    if (checkoutChannel) checkoutNowUrl.searchParams.set('channel', checkoutChannel);
    const checkoutReturnToRaw = typeof process.env.SHOPIFY_CHECKOUT_RETURN_TO === 'string'
      ? process.env.SHOPIFY_CHECKOUT_RETURN_TO.trim()
      : '';
    const checkoutReturnTo = checkoutReturnToRaw || '/checkout';
    if (checkoutReturnTo) {
      checkoutNowUrl.searchParams.set('return_to', checkoutReturnTo);
    }
  }

  return {
    cartUrl: cartAddUrl.toString(),
    cartUrlFollow: cartAddUrl.toString(),
    cartPlain: cartPlainString || undefined,
    checkoutUrlNow: checkoutNowUrl ? checkoutNowUrl.toString() : undefined,
    checkoutPlain: checkoutPlainUrl ? checkoutPlainUrl.toString() : undefined,
  };
}

const CART_CREATE_MUTATION = `
  mutation CartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

async function tryCreateStorefrontCart({
  base,
  variantGid,
  quantity,
  buyerIp,
  attributes,
  note,
}) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid' };
  }
  const input = {
    lines: [
      {
        merchandiseId: variantGid,
        quantity,
      },
    ],
  };
  const mergedAttributes = mergeAttributes(attributes);
  if (mergedAttributes.length) {
    input.attributes = mergedAttributes;
  }
  const noteValue = normalizeCartNote(note);
  if (noteValue) {
    input.note = noteValue;
  }

  try {
    const resp = await shopifyStorefrontGraphQL(
      CART_CREATE_MUTATION,
      { input },
      { buyerIp },
    );
    const text = await resp.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      return { ok: false, reason: 'http_error', status: resp.status, body: text?.slice(0, 2000) };
    }
    if (!json || typeof json !== 'object') {
      return { ok: false, reason: 'invalid_response' };
    }
    if (Array.isArray(json.errors) && json.errors.length) {
      return { ok: false, reason: 'graphql_errors', errors: json.errors };
    }
    const cartCreate = json?.data?.cartCreate;
    if (!cartCreate || typeof cartCreate !== 'object') {
      return { ok: false, reason: 'invalid_response' };
    }
    const userErrors = Array.isArray(cartCreate.userErrors)
      ? cartCreate.userErrors.filter((err) => err && typeof err.message === 'string' && err.message.trim())
      : [];
    if (userErrors.length) {
      return { ok: false, reason: 'user_errors', userErrors };
    }
    const cart = cartCreate.cart;
    if (!cart || typeof cart !== 'object' || !cart.id) {
      return { ok: false, reason: 'missing_cart' };
    }
    const token = String(cart.id).split('/').pop();
    if (!token) {
      return { ok: false, reason: 'missing_cart_token' };
    }
    const baseUrl = base.replace(/\/$/, '');
    const cartUrl = `${baseUrl}/cart/c/${token}`;
    return {
      ok: true,
      cartUrl,
      cartUrlFollow: cartUrl,
      cartPlain: `${baseUrl}/cart`,
      checkoutUrlNow: typeof cart.checkoutUrl === 'string' && cart.checkoutUrl ? cart.checkoutUrl : undefined,
      checkoutPlain: `${baseUrl}/checkout`,
      cartId: cart.id,
      cartToken: token,
    };
  } catch (err) {
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return { ok: false, reason: 'storefront_env_missing', missing: err.missing };
    }
    return { ok: false, reason: 'exception', error: err };
  }
}

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    attributes: z.any().optional(),
    cartAttributes: z.any().optional(),
    note: z.any().optional(),
  })
  .passthrough();

export default async function createCartLink(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
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
    const {
      variantId,
      variantGid,
      quantity,
      attributes: attrInput,
      cartAttributes,
      note,
    } = parsed.data;
    const normalizedVariantId = normalizeVariantId(variantId ?? variantGid);
    if (!normalizedVariantId) {
      return res.status(400).json({ ok: false, error: 'missing_variant' });
    }
    const variantGidValue = ensureVariantGid(variantGid, variantId, normalizedVariantId);
    const qtyRaw = Number(quantity);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(Math.floor(qtyRaw), 99) : 1;
    const base = getPublicStorefrontBase();
    if (!base) return res.status(500).json({ ok: false, error: 'missing_store_domain' });

    const attributes = collectCustomAttributes(cartAttributes ?? attrInput);
    const buyerIp = getClientIp(req);

    const storefrontAttempt = await tryCreateStorefrontCart({
      base,
      variantGid: variantGidValue,
      quantity: qty,
      buyerIp,
      attributes,
      note,
    });

    if (storefrontAttempt.ok) {
      return res.status(200).json({
        ok: true,
        url: storefrontAttempt.cartUrl,
        cart_url: storefrontAttempt.cartUrl,
        cart_url_follow: storefrontAttempt.cartUrlFollow || storefrontAttempt.cartUrl,
        cart_plain: storefrontAttempt.cartPlain,
        checkout_url_now: storefrontAttempt.checkoutUrlNow,
        checkout_plain: storefrontAttempt.checkoutPlain,
        cart_id: storefrontAttempt.cartId,
        cart_token: storefrontAttempt.cartToken,
        cart_method: 'storefront',
      });
    }

    if (storefrontAttempt.reason === 'storefront_env_missing') {
      return res.status(500).json({
        ok: false,
        error: 'shopify_storefront_env_missing',
        missing: storefrontAttempt.missing,
      });
    }

    if (storefrontAttempt.reason === 'user_errors') {
      const detailMessages = (storefrontAttempt.userErrors || [])
        .map((err) => (typeof err?.message === 'string' ? err.message.trim() : ''))
        .filter(Boolean);
      return res.status(422).json({
        ok: false,
        error: 'shopify_cart_user_error',
        detail: storefrontAttempt.userErrors,
        message: detailMessages.join(' ') || 'Shopify rechazó la creación del carrito.',
      });
    }

    if (storefrontAttempt.reason && storefrontAttempt.reason !== 'missing_variant_gid') {
      try {
        console.error('create_cart_link_storefront_failed', {
          reason: storefrontAttempt.reason,
          status: storefrontAttempt.status,
        });
      } catch {}
    }

    const fallback = buildLegacyCartPayload(base, normalizedVariantId, qty);
    if (!fallback) {
      return res.status(500).json({ ok: false, error: 'create_cart_link_failed' });
    }

    return res.status(200).json({
      ok: true,
      url: fallback.cartUrl,
      cart_url: fallback.cartUrl,
      cart_url_follow: fallback.cartUrlFollow,
      cart_plain: fallback.cartPlain,
      checkout_url_now: fallback.checkoutUrlNow,
      checkout_plain: fallback.checkoutPlain,
      cart_method: 'legacy',
    });
  } catch (e) {
    if (res.statusCode === 413) {
      return res.json({ ok: false, error: 'payload_too_large' });
    }
    if (res.statusCode === 400) {
      return res.json({ ok: false, error: 'invalid_json' });
    }
    try { console.error('create_cart_link_error', e); } catch {}
    return res.status(500).json({ ok: false, error: 'create_cart_link_failed' });
  }
}

