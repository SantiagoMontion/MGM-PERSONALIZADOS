import { getPublicStorefrontBase } from '../publicStorefront.js';

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

export default async function createCheckout(req, res) {
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

    let checkoutUrl;
    try {
      checkoutUrl = new URL(`/cart/${normalizedVariantId}:${qty}`, base);
    } catch (err) {
      console.error('create_checkout_url_error', err);
      return res.status(500).json({ ok: false, error: 'invalid_store_domain' });
    }

    checkoutUrl.searchParams.set('channel', 'buy_button');
    checkoutUrl.searchParams.set('return_to', '/checkout');

    return res.status(200).json({ ok: true, url: checkoutUrl.toString() });
  } catch (e) {
    console.error('create_checkout_error', e);
    return res.status(500).json({ ok: false, error: 'create_checkout_failed' });
  }
}

