import { buildCorsHeaders } from '../cors';
import { shopifyAdmin } from '../shopify';

function formatDimension(value: unknown): string | undefined {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  const rounded = Math.round(num * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1).replace(/\.0+$/, '');
}

function formatMeasurement(width: unknown, height: unknown): string | undefined {
  const w = formatDimension(width);
  const h = formatDimension(height);
  if (!w || !h) return undefined;
  return `${w}x${h}`;
}

function ensureQuoted(value: string | undefined): string | undefined {
  const base = (value || '').trim();
  if (!base) return undefined;
  return `"${base.replace(/"/g, "'")}"`;
}

function withCmSuffix(measurement?: string): string | undefined {
  if (!measurement) return undefined;
  const trimmed = measurement.trim();
  if (!trimmed) return undefined;
  return /cm$/i.test(trimmed) ? trimmed : `${trimmed} cm`;
}

function buildGlasspadTitle(measurement?: string): string {
  const parts = ['GLASSPAD'];
  const quotedMeasurement = ensureQuoted(withCmSuffix(measurement));
  if (quotedMeasurement) parts.push(quotedMeasurement);
  return `${parts.join(' ')} | PERSONALIZADO`;
}

export default async function handler(req: any, res: any) {
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
    const measurementLabel = formatMeasurement(width, height);
    const title = mode === 'Glasspad'
      ? buildGlasspadTitle(measurementLabel)
      : `Mousepad Personalizado - ${mode}${measurementLabel ? ` ${measurementLabel}` : ''}`;
    const payload = {
      product: {
        title,
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

