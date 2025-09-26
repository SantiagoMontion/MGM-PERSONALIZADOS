import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { buildCorsHeaders } from '../cors';
import { shopifyAdmin } from '../shopify';
import { slugifyName, sizeLabel } from '../_lib/slug.js';
import { supa } from '../supa.js';

const OUTPUT_BUCKET = 'outputs';

type DataUrlPayload = {
  mimeType: string;
  buffer: Buffer;
  extension: string;
};

function parseDataUrl(value: unknown): DataUrlPayload {
  if (typeof value !== 'string') {
    throw new Error('invalid_data_url');
  }
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value.trim());
  if (!match) {
    throw new Error('invalid_data_url');
  }
  const [, mime, b64] = match;
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) {
    throw new Error('empty_data_url');
  }
  const normalizedMime = mime.toLowerCase();
  let extension = 'bin';
  if (normalizedMime === 'image/png') extension = 'png';
  else if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') extension = 'jpg';
  else if (normalizedMime === 'image/webp') extension = 'webp';
  else if (normalizedMime === 'image/svg+xml') extension = 'svg';
  else if (normalizedMime === 'application/pdf') extension = 'pdf';
  return { mimeType: normalizedMime, buffer, extension };
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : null;
}

function buildStorageBaseKey({
  productHandle,
  productId,
  designName,
  widthCm,
  heightCm,
  material,
}: {
  productHandle?: string;
  productId?: string;
  designName?: string;
  widthCm?: number | null;
  heightCm?: number | null;
  material?: string;
}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const designSlug = slugifyName(designName || '') || null;
  const materialSlug = slugifyName(material || '') || null;
  const width = safeNumber(widthCm);
  const height = safeNumber(heightCm);
  const measurement = width && height ? sizeLabel(width, height) : null;
  const handleSlug = slugifyName(productHandle || '') || null;
  const numericId = (productId || '').replace(/[^0-9a-z]+/gi, '').slice(-10);
  const identifier = handleSlug || (numericId ? `p${numericId}` : randomUUID().slice(0, 8));
  const descriptorParts = [designSlug, measurement ? measurement.toLowerCase() : null, materialSlug]
    .filter(Boolean);
  const descriptor = descriptorParts.length ? descriptorParts.join('-') : 'design';
  return `products/${year}/${month}/${identifier}/${descriptor}`;
}

function buildPublicUrl(key: string) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/?$/, '');
  return `${base}/storage/v1/object/public/${OUTPUT_BUCKET}/${key}`;
}

async function uploadToSupabase(
  key: string,
  buffer: Buffer,
  contentType: string,
) {
  const storage = supa.storage.from(OUTPUT_BUCKET);
  const { error } = await storage.upload(key, buffer, { contentType, upsert: true });
  if (error) {
    throw error;
  }
  return buildPublicUrl(key);
}

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

function buildGlasspadTitle(measurement?: string): string {
  const parts = ['Glasspad'];
  const normalizedMeasurement = (measurement || '').trim();
  if (normalizedMeasurement) parts.push(normalizedMeasurement);
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
    let mockupPayload: DataUrlPayload;
    try {
      mockupPayload = parseDataUrl(mockup_dataurl);
    } catch {
      return res.status(400).json({ ok: false, message: 'invalid_mockup_dataurl' });
    }
    if (typeof image_dataurl !== 'string') {
      return res.status(400).json({ ok: false, message: 'missing_image_dataurl' });
    }
    let imagePayload: DataUrlPayload;
    try {
      imagePayload = parseDataUrl(image_dataurl);
    } catch {
      return res.status(400).json({ ok: false, message: 'invalid_image_dataurl' });
    }
    let pdfBuffer: Buffer;
    if (imagePayload.mimeType === 'application/pdf') {
      pdfBuffer = imagePayload.buffer;
    } else if (imagePayload.mimeType.startsWith('image/')) {
      try {
        pdfBuffer = await sharp(imagePayload.buffer)
          .flatten({ background: '#ffffff' })
          .withMetadata({ density: 300 })
          .toFormat('pdf')
          .toBuffer();
      } catch (err) {
        console.error('shopify_create_product_pdf', err);
        return res.status(500).json({ ok: false, message: 'pdf_generation_failed' });
      }
    } else {
      return res.status(400).json({ ok: false, message: 'unsupported_image_dataurl' });
    }
    const base64 = mockupPayload.buffer.toString('base64');
    const measurementLabel = formatMeasurement(width, height);
    const title = mode === 'Glasspad'
      ? buildGlasspadTitle(measurementLabel)
      : `Mousepad Personalizado - ${mode}${measurementLabel ? ` ${measurementLabel}` : ''}`;
    const designNameRaw = typeof req.body?.design_name === 'string'
      ? req.body.design_name
      : typeof req.body?.designName === 'string'
        ? req.body.designName
        : '';
    const designNameForPath = designNameRaw || title;
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
    try {
      const baseKey = buildStorageBaseKey({
        productHandle: product?.handle,
        productId: product?.id ? String(product.id) : undefined,
        designName: designNameForPath,
        widthCm: width,
        heightCm: height,
        material: mode,
      });
      const mockupExt = mockupPayload.extension === 'bin' || mockupPayload.extension === 'pdf'
        ? 'png'
        : mockupPayload.extension;
      const pdfKey = `${baseKey}/print.pdf`;
      const mockupKey = `${baseKey}/mockup.${mockupExt}`;
      const [pdfUrl, mockupUrl] = await Promise.all([
        uploadToSupabase(pdfKey, pdfBuffer, 'application/pdf'),
        uploadToSupabase(mockupKey, mockupPayload.buffer, mockupPayload.mimeType),
      ]);
      return res.status(200).json({
        ok: true,
        productUrl,
        checkoutUrl,
        assets: {
          pdf_url: pdfUrl,
          mockup_url: mockupUrl,
          storage_key_prefix: baseKey,
        },
      });
    } catch (uploadErr: any) {
      console.error('shopify_create_product_supabase', uploadErr);
      return res.status(500).json({ ok: false, message: 'supabase_upload_failed' });
    }
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return res.status(status).json({ ok: false, message: e?.message || 'shopify_error' });
  }
}

