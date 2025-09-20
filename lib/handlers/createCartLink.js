import { getPublicStorefrontBase } from '../publicStorefront.js';
import { getShopifySalesChannel } from '../shopify.js';

function ensureBody(req) {
  let b = req.body;
  if (!b || typeof b !== 'object') {
    try { b = JSON.parse(b || '{}'); } catch { b = {}; }
  }
  return b;
}

function normalizeVariantId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

export default async function createCartLink(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const { variantId, quantity, variantGid } = ensureBody(req);
    const normalizedVariantId = normalizeVariantId(variantId || variantGid);
    if (!normalizedVariantId) return res.status(400).json({ ok: false, error: 'missing_variant' });
    const qty = Number(quantity) > 0 ? Number(quantity) : 1;
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

    const cartFollowUrl = buildUrl(`/cart/${normalizedVariantId}:${qty}`);
    if (!cartFollowUrl) {
      return res.status(500).json({ ok: false, error: 'invalid_store_domain' });
    }
    const cartChannel = getShopifySalesChannel('cart');
    if (cartChannel) cartFollowUrl.searchParams.set('channel', cartChannel);

    const homeUrl = buildUrl('/');
    const cartPlainUrl = buildUrl('/cart');
    const checkoutPlainUrl = buildUrl('/checkout');

    const returnToCart = (() => {
      const raw = typeof process.env.SHOPIFY_CART_RETURN_TO === 'string'
        ? process.env.SHOPIFY_CART_RETURN_TO.trim()
        : '';
      const sanitized = raw && !/checkout/i.test(raw) ? raw : '';
      if (sanitized) return sanitized;
      if (homeUrl) return homeUrl.toString();
      if (cartPlainUrl) return cartPlainUrl.toString();
      try {
        return new URL('/', base).toString();
      } catch {
        return '/';
      }
    })();
    if (returnToCart) {
      cartFollowUrl.searchParams.set('return_to', returnToCart);
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
      url: cartFollowUrl.toString(),
      cart_url: cartFollowUrl.toString(),
      cart_url_follow: cartFollowUrl.toString(),
      cart_plain: cartPlainUrl ? cartPlainUrl.toString() : undefined,
      checkout_url_now: checkoutNowUrl ? checkoutNowUrl.toString() : undefined,
      checkout_plain: checkoutPlainUrl ? checkoutPlainUrl.toString() : undefined,
    });
  } catch (e) {
    console.error('create_cart_link_error', e);
    return res.status(500).json({ ok: false, error: 'create_cart_link_failed' });
  }
}

