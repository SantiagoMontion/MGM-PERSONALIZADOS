import { withCors } from '../lib/cors';
import { shopifyAdmin } from '../lib/shopify.js';

function ensureBody(req) {
  let b = req.body;
  if (!b || typeof b !== 'object') {
    try { b = JSON.parse(b || '{}'); } catch { b = {}; }
  }
  return b;
}

export default withCors(async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const { mockupDataUrl, productType, title, tags } = ensureBody(req);
    if (typeof mockupDataUrl !== 'string') {
      return res.status(400).json({ ok: false, error: 'invalid_mockup' });
    }
    const base64 = mockupDataUrl.split(',')[1] || '';
    const payload = {
      product: {
        title: title || `Personalizado ${productType || ''}`,
        body_html: '<p>Producto personalizado</p>',
        tags: tags || '',
        images: [{ attachment: base64 }],
        variants: [{ price: '0.00' }],
        status: 'draft',
      },
    };
    const { product } = await shopifyAdmin('/products.json', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.status(200).json({
      ok: true,
      productId: String(product.id),
      variantId: String(product.variants?.[0]?.id || ''),
    });
  } catch (e) {
    console.error('publish_product_error', e);
    return res.status(500).json({ ok: false, error: 'publish_failed' });
  }
});
