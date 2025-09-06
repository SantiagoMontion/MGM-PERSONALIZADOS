function ensureBody(req) {
  let b = req.body;
  if (!b || typeof b !== 'object') {
    try { b = JSON.parse(b || '{}'); } catch { b = {}; }
  }
  return b;
}

export default async function createCheckout(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const { variantId, quantity } = ensureBody(req);
    if (!variantId) return res.status(400).json({ ok: false, error: 'missing_variant' });
    const qty = Number(quantity) > 0 ? Number(quantity) : 1;
    const base = process.env.SHOPIFY_PUBLIC_BASE || `https://${process.env.SHOPIFY_STORE_DOMAIN}`;
    const url = `${base}/cart/add?items[0][id]=${encodeURIComponent(variantId)}&items[0][quantity]=${qty}&return_to=%2Fcheckout`;
    return res.status(200).json({ ok: true, url });
  } catch (e) {
    console.error('create_checkout_error', e);
    return res.status(500).json({ ok: false, error: 'create_checkout_failed' });
  }
}

