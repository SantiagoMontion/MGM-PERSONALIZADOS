import { z } from 'zod';
import { getPublicStorefrontBase } from '../publicStorefront.js';
import { getShopifySalesChannel } from '../shopify.js';
import { parseJsonBody } from '../_lib/http.js';

function normalizeVariantId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
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

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
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
    const { variantId, variantGid, quantity } = parsed.data;
    const normalizedVariantId = normalizeVariantId(variantId ?? variantGid);
    if (!normalizedVariantId) {
      return res.status(400).json({ ok: false, error: 'missing_variant' });
    }
    const qtyRaw = Number(quantity);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(Math.floor(qtyRaw), 99) : 1;
    const base = getPublicStorefrontBase();
    if (!base) return res.status(500).json({ ok: false, error: 'missing_store_domain' });

    const buildUrl = (path) => {
      try {
        return new URL(path, base);
      } catch (err) {
        console.error('create_cart_link_url_error', err);
        return null;
      }
    };

    const cartAddUrl = buildUrl('/cart/add');
    if (!cartAddUrl) {
      return res.status(500).json({ ok: false, error: 'invalid_store_domain' });
    }
    cartAddUrl.searchParams.set('id', normalizedVariantId);
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
    const returnToCart = candidates.find((value) => sanitizeReturnTarget(value)) || '/';
    if (returnToCart) {
      cartAddUrl.searchParams.set('return_to', returnToCart);
    }

    const checkoutNowUrl = buildUrl(`/cart/${normalizedVariantId}:${qty}`);
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

    return res.status(200).json({
      ok: true,
      url: cartAddUrl.toString(),
      cart_url: cartAddUrl.toString(),
      cart_url_follow: cartAddUrl.toString(),
      cart_plain: cartPlainString || undefined,
      checkout_url_now: checkoutNowUrl ? checkoutNowUrl.toString() : undefined,
      checkout_plain: checkoutPlainUrl ? checkoutPlainUrl.toString() : undefined,
    });
  } catch (e) {
    if (res.statusCode === 413) {
      return res.json({ ok: false, error: 'payload_too_large' });
    }
    if (res.statusCode === 400) {
      return res.json({ ok: false, error: 'invalid_json' });
    }
    console.error('create_cart_link_error', e);
    return res.status(500).json({ ok: false, error: 'create_cart_link_failed' });
  }
}

