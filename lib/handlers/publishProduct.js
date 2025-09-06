import { shopifyAdmin } from '../shopify.js';

export async function publishProduct(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    // Safe JSON parse
    let body = req.body;
    if (!body || typeof body !== 'object') {
      try { body = JSON.parse(String(body || '')) || {}; } catch { body = {}; }
    }

    const title = typeof body.title === 'string' ? body.title : '';
    const description = typeof body.description === 'string' ? body.description : '';
    const mockupDataUrl = typeof body.mockupDataUrl === 'string' ? body.mockupDataUrl : '';
    const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'mockup.png';
    const productType = typeof body.productType === 'string' && body.productType ? body.productType : 'Mousepad';
    const price = body.price != null ? String(body.price) : undefined;

    if (!title || !mockupDataUrl) {
      return res.status(400).json({ ok: false, reason: 'missing_fields' });
    }
    const b64 = (mockupDataUrl.split(',')[1] || '').trim();
    if (!b64) return res.status(400).json({ ok: false, reason: 'invalid_mockup_dataurl' });

    const payload = {
      product: {
        title,
        body_html: description || '',
        product_type: productType,
        images: [{ attachment: b64, filename, alt: title }],
        ...(price ? { variants: [{ price: String(price) }] } : {}),
      },
    };

    const resp = await shopifyAdmin('products.json', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return res.status(502).json({ ok: false, reason: 'shopify_error', status: resp.status, body: text.slice(0, 1000) });
    }
    const data = await resp.json();
    const product = data?.product || {};
    return res.status(200).json({ ok: true, product: { id: product.id, handle: product.handle, admin_graphql_api_id: product.admin_graphql_api_id } });
  } catch (e) {
    if (e?.message === 'SHOPIFY_ENV_MISSING') {
      return res.status(400).json({ ok: false, reason: 'shopify_env_missing', missing: e?.missing || ['SHOPIFY_STORE_DOMAIN','SHOPIFY_ADMIN_TOKEN'] });
    }
    console.error('publish_product_error', e);
    return res.status(500).json({ ok: false, reason: 'internal_error' });
  }
}

export default publishProduct;

