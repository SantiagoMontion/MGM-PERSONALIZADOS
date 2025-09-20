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
    const base = process.env.SHOPIFY_PUBLIC_BASE || `https://${process.env.SHOPIFY_STORE_DOMAIN}`;
    const url = `${base}/cart/add?items[0][id]=${encodeURIComponent(normalizedVariantId)}&items[0][quantity]=${qty}&return_to=%2Fcheckout`;
    return res.status(200).json({ ok: true, url });
  } catch (e) {
    console.error('create_checkout_error', e);
    return res.status(500).json({ ok: false, error: 'create_checkout_failed' });
  }
}

