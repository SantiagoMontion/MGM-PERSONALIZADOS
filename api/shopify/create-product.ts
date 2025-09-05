import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildCorsHeaders } from '../../lib/cors';
import { shopifyAdmin } from '../../lib/shopify';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || null;
  const cors = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ message: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v as string));
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'method_not_allowed' });
  }
  if (!cors) return res.status(403).json({ ok: false, message: 'origin_not_allowed' });
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v as string));

  try {
    const { mode, width_cm, height_cm, bleed_mm, rotate_deg, image_dataurl, mockup_dataurl } = req.body || {};
    const modeOk = ['Classic', 'Pro', 'Glasspad'].includes(mode);
    const width = Number(width_cm);
    const height = Number(height_cm);
    const bleed = Number(bleed_mm);
    const rotate = Number(rotate_deg);
    if (!modeOk || Number.isNaN(width) || Number.isNaN(height) || Number.isNaN(bleed) || Number.isNaN(rotate)) {
      return res.status(400).json({ ok: false, message: 'invalid_fields' });
    }
    if (typeof mockup_dataurl !== 'string' || !mockup_dataurl.startsWith('data:image/')) {
      return res.status(400).json({ ok: false, message: 'invalid_mockup' });
    }
    const base64 = mockup_dataurl.split(',')[1];
    const payload = {
      product: {
        title: `Mousepad Personalizado - ${mode}`,
        body_html: `<p>Personalizado ${width}x${height} cm</p>`,
        images: [{ attachment: base64 }],
        variants: [{ price: '0.00' }],
        status: 'draft'
      }
    };
    const { product } = await shopifyAdmin('/products.json', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const pubBase = process.env.SHOPIFY_PUBLIC_BASE || `https://${process.env.SHOPIFY_STORE_DOMAIN}`;
    const productUrl = `${pubBase}/products/${product.handle}`;
    const variantId = String(product?.variants?.[0]?.id || '');
    const checkoutUrl = `${pubBase}/cart/${variantId}:1`;
    return res.status(200).json({ ok: true, productUrl, checkoutUrl });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return res.status(status).json({ ok: false, message: e?.message || 'shopify_error' });
  }
}
