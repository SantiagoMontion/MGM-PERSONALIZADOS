import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { buildCorsHeaders } from '../cors';
import { shopifyAdmin } from '../shopify';
import { slugifyName, sizeLabel } from '../_lib/slug.js';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import savePrintPdfToSupabase, { savePrintPreviewToSupabase } from '../_lib/savePrintPdfToSupabase.js';
import imageBufferToPdf from '../_lib/imageToPdf.js';
import logger from '../_lib/logger.js';

type DataUrlPayload = {
  mimeType: string;
  buffer: Buffer;
  extension: string;
};

type MetadataRecord = Record<string, string | number | boolean | null | undefined>;

type UploadResult = {
  path: string;
  signedUrl: string | null;
  publicUrl: string | null;
  expiresIn: number;
};

const OUTPUT_BUCKET = 'outputs';
const SIGNED_URL_TTL_SECONDS = 600;

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

function buildPdfFilename({
  designName,
  widthCm,
  heightCm,
  material,
}: {
  designName?: string;
  widthCm?: number | null;
  heightCm?: number | null;
  material?: string;
}) {
  const designSlug = slugifyName(designName || '') || 'design';
  const width = safeNumber(widthCm);
  const height = safeNumber(heightCm);
  const measurement = width && height ? sizeLabel(width, height) : null;
  const materialRaw = typeof material === 'string' ? material : '';
  const materialSegment = materialRaw
    ? materialRaw
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .toUpperCase()
        .replace(/^-+|-+$/g, '') || 'CUSTOM'
    : 'CUSTOM';
  const hash = randomUUID().replace(/[^a-z0-9]+/gi, '').slice(0, 8) || randomUUID().slice(0, 8);
  const parts = [designSlug];
  if (measurement) parts.push(measurement);
  parts.push(materialSegment);
  parts.push(hash);
  return `${parts.join('-')}.pdf`;
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
  return `${parts.join(' ')} | MGM-EDITOR`;
}


function normalizeProductTypeForTemplateSuffix(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function resolveTemplateSuffixByProductType(productTypeRaw: unknown): string {
  const normalized = normalizeProductTypeForTemplateSuffix(productTypeRaw);
  if (normalized.includes('glass')) return 'glasspads';
  if (normalized.includes('alfombr')) return 'alfombras';
  if (normalized.includes('pro') || normalized.includes('classic')) return 'mousepads';
  return 'mousepads';
}

type LegacyStorageArgs = {
  productHandle?: string | null;
  productId?: string | null;
  designName?: string | null;
  widthCm?: number | null;
  heightCm?: number | null;
  material?: string | null;
};

function buildLegacyStorageBaseKey({
  productHandle,
  productId,
  designName,
  widthCm,
  heightCm,
  material,
}: LegacyStorageArgs) {
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
  const base = `products/${year}/${month}/${identifier}/${descriptor}`;
  return base.replace(/\/+/g, '/');
}

function buildLegacyAssetPath(baseKey: string, filename: string) {
  const normalizedBase = String(baseKey || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const normalizedFilename = String(filename || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedBase) return normalizedFilename;
  if (!normalizedFilename) return normalizedBase;
  return `${normalizedBase}/${normalizedFilename}`;
}

function determineMockupExtension(payload: DataUrlPayload) {
  const ext = (payload?.extension || '').toLowerCase();
  if (!ext || ext === 'bin' || ext === 'pdf') return 'png';
  return ext;
}

function normalizeMetadata(meta: MetadataRecord = {}) {
  const base: Record<string, string> = { private: 'true', createdBy: 'editor' };
  const output: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    if (typeof value === 'boolean') {
      output[key] = value ? 'true' : 'false';
    } else {
      output[key] = typeof value === 'string' ? value : String(value);
    }
  }
  if (!('private' in meta)) output.private = 'true';
  if (!('createdBy' in meta)) output.createdBy = 'editor';
  return output;
}

async function uploadAssetToSupabase({
  path,
  buffer,
  contentType,
  metadata,
  logLabel,
}: {
  path: string;
  buffer: Buffer;
  contentType: string;
  metadata?: MetadataRecord;
  logLabel?: string;
}): Promise<UploadResult> {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error: any = new Error('buffer_empty');
    error.code = 'buffer_empty';
    throw error;
  }

  const normalizedPath = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedPath || normalizedPath.includes('..')) {
    const error: any = new Error('invalid_path');
    error.code = 'invalid_path';
    throw error;
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err: any) {
    logger.error('shopify_asset_supabase_env', { message: err?.message || err });
    const error: any = new Error('Faltan credenciales de Supabase');
    error.code = 'supabase_credentials_missing';
    error.cause = err;
    throw error;
  }

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  const size = buffer.length;
  const label = logLabel || 'asset';

  logger.debug('shopify_asset_upload_start', {
    label,
    bucket: OUTPUT_BUCKET,
    path: normalizedPath,
    sizeBytes: size,
    contentType,
  });

  const { error: uploadError } = await storage.upload(normalizedPath, buffer, {
    upsert: true,
    cacheControl: '3600',
    contentType,
    metadata: normalizeMetadata(metadata || {}),
  });

  if (uploadError) {
    logger.error('shopify_asset_upload_error', {
      label,
      bucket: OUTPUT_BUCKET,
      path: normalizedPath,
      sizeBytes: size,
      status: uploadError?.status || uploadError?.statusCode || null,
      message: uploadError?.message,
      name: uploadError?.name,
    });
    const error: any = new Error('supabase_upload_failed');
    error.code = 'supabase_upload_failed';
    error.cause = uploadError;
    throw error;
  }

  const { data: signedData, error: signedError } = await storage.createSignedUrl(
    normalizedPath,
    SIGNED_URL_TTL_SECONDS,
    { download: true },
  );

  if (signedError) {
    logger.error('shopify_asset_signed_url_error', {
      label,
      path: normalizedPath,
      status: signedError?.status || signedError?.statusCode || null,
      message: signedError?.message,
      name: signedError?.name,
    });
  }

  const { data: publicData } = storage.getPublicUrl(normalizedPath);

  logger.debug('shopify_asset_upload_ok', {
    label,
    bucket: OUTPUT_BUCKET,
    path: normalizedPath,
    sizeBytes: size,
  });

  return {
    path: normalizedPath,
    signedUrl: signedData?.signedUrl || null,
    publicUrl: publicData?.publicUrl || null,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  };
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
    if (cors) {
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v as string));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(405).json({ ok: false, message: 'method_not_allowed' });
  }
  if (!cors) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(403).json({ ok: false, message: 'origin_not_allowed' });
  }
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v as string));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const { mode, width_cm, height_cm, bleed_mm, rotate_deg, image_dataurl, mockup_dataurl } = req.body || {};
    const modeOk = ['Classic', 'Pro', 'Glasspad'].includes(mode);
    const width = Number(width_cm);
    const height = Number(height_cm);
    const bleed = Number(bleed_mm);
    const rotate = Number(rotate_deg);
    const EXTRA_MARGIN_TOTAL_CM = 2;
    const marginPerSideCm = EXTRA_MARGIN_TOTAL_CM / 2;
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
    let previewBuffer: Buffer | null = null;
    if (imagePayload.mimeType === 'application/pdf') {
      pdfBuffer = imagePayload.buffer;
    } else if (imagePayload.mimeType.startsWith('image/')) {
      try {
        const pdfResult = await imageBufferToPdf({
          buffer: imagePayload.buffer,
          density: 300,
          background: '#ffffff',
          widthCm: Number.isFinite(width) ? width : undefined,
          heightCm: Number.isFinite(height) ? height : undefined,
          bleedCm: marginPerSideCm,
        });
        pdfBuffer = pdfResult.pdfBuffer;
      } catch (err) {
        logger.error('shopify_create_product_pdf', err);
        return res.status(500).json({ ok: false, message: 'pdf_generation_failed' });
      }
    } else {
      return res.status(400).json({ ok: false, message: 'unsupported_image_dataurl' });
    }
    const base64 = mockupPayload.buffer.toString('base64');
    const measurementLabel = formatMeasurement(width, height);
    const title = mode === 'Glasspad'
      ? buildGlasspadTitle(measurementLabel)
      : `Mousepad Personalizado - ${mode}${measurementLabel ? ` ${measurementLabel}` : ''} | MGM-EDITOR`;
    const productTypeRaw = typeof req.body?.productType === 'string'
      ? req.body.productType
      : typeof req.body?.options?.productType === 'string'
        ? req.body.options.productType
        : 'mousepad';
    const templateSuffix = resolveTemplateSuffixByProductType(productTypeRaw);
    const designNameRaw = typeof req.body?.design_name === 'string'
      ? req.body.design_name
      : typeof req.body?.designName === 'string'
        ? req.body.designName
        : '';
    const designNameForPath = designNameRaw || title;
    const payload = {
      product: {
        title,
        template_suffix: templateSuffix,
        body_html: `<p>Personalizado ${width}x${height} cm</p>`,
        images: [{ attachment: base64 }],
        variants: [{
          price: '0.00',
          inventory_policy: 'continue',
          inventory_management: null,
        }],
        status: 'active',
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
      const pdfFilename = buildPdfFilename({
        designName: designNameForPath,
        widthCm: Number.isFinite(width) ? width : undefined,
        heightCm: Number.isFinite(height) ? height : undefined,
        material: mode,
      });
      const pdfMetadata: MetadataRecord = {
        private: true,
        createdBy: 'editor',
        slug: slugifyName(designNameForPath) || 'design',
      };
      if (Number.isFinite(width)) {
        pdfMetadata.widthCm = Number(width);
        pdfMetadata.widthCmPrint = Number(width) + EXTRA_MARGIN_TOTAL_CM;
      }
      if (Number.isFinite(height)) {
        pdfMetadata.heightCm = Number(height);
        pdfMetadata.heightCmPrint = Number(height) + EXTRA_MARGIN_TOTAL_CM;
      }
      if (mode) pdfMetadata.material = mode;
      if (product?.id) pdfMetadata.productId = String(product.id);
      if (variantId) pdfMetadata.variantId = variantId;

      let pdfUpload;
      try {
        pdfUpload = await savePrintPdfToSupabase(
          pdfBuffer,
          pdfFilename,
          pdfMetadata,
        );
      } catch (uploadErr: any) {
        if (uploadErr?.code === 'supabase_object_too_large') {
          return res.status(413).json({
            ok: false,
            reason: 'pdf_too_large',
            message: 'El PDF generado supera el tamao permitido por Supabase.',
            limit_bytes: uploadErr.limit ?? undefined,
            size_bytes: uploadErr.size ?? undefined,
          });
        }
        throw uploadErr;
      }
      const {
        path: pdfPath,
        signedUrl: pdfSignedUrl,
        publicUrl: pdfPublicUrl,
        expiresIn,
      } = pdfUpload;

      const effectivePdfUrl = pdfPublicUrl || pdfSignedUrl || null;
      const previewPath = pdfPath.startsWith('outputs/') ? pdfPath : `outputs/${pdfPath}`;
      const previewUrl = `/api/prints/preview?path=${encodeURIComponent(previewPath)}`;

      const legacyBaseKey = buildLegacyStorageBaseKey({
        productHandle: product?.handle,
        productId: product?.id ? String(product.id) : null,
        designName: designNameForPath,
        widthCm: width,
        heightCm: height,
        material: mode,
      });

      const mockupExtension = determineMockupExtension(mockupPayload);
      const mockupPath = buildLegacyAssetPath(legacyBaseKey, `mockup.${mockupExtension}`);

      const mockupUpload = await uploadAssetToSupabase({
        path: mockupPath,
        buffer: mockupPayload.buffer,
        contentType: mockupPayload.mimeType,
        metadata: { ...pdfMetadata, assetType: 'mockup_image' },
        logLabel: 'mockup',
      });

      let legacyPdfUpload: UploadResult | null = null;
      try {
        legacyPdfUpload = await uploadAssetToSupabase({
          path: buildLegacyAssetPath(legacyBaseKey, 'print.pdf'),
          buffer: pdfBuffer,
          contentType: 'application/pdf',
          metadata: { ...pdfMetadata, assetType: 'print_pdf', legacy: true },
          logLabel: 'legacy_pdf',
        });
      } catch (legacyErr: any) {
        logger.warn('shopify_create_product_legacy_pdf_failed', {
          message: legacyErr?.message || legacyErr,
          code: legacyErr?.code || null,
        });
        legacyPdfUpload = null;
      }

      const assets: Record<string, unknown> = {
        pdf_url: effectivePdfUrl,
        pdf_path: pdfPath,
        pdf_expires_in: expiresIn,
        preview_url: previewUrl,
        mockup_url: mockupUpload.publicUrl || mockupUpload.signedUrl || null,
        mockup_path: mockupUpload.path,
        storage_key_prefix: legacyBaseKey,
      };

      const responsePayload: Record<string, unknown> = {
        ok: true,
        productUrl,
        checkoutUrl,
        assets,
        pdf: {
          path: pdfPath,
          download_url: effectivePdfUrl,
          expires_in: expiresIn,
        },
      };

      if (mockupUpload) {
        responsePayload.mockup = {
          path: mockupUpload.path,
          download_url: mockupUpload.publicUrl || mockupUpload.signedUrl || null,
          expires_in: mockupUpload.expiresIn,
        };
      }

      if (legacyPdfUpload) {
        responsePayload.legacy_pdf = {
          path: legacyPdfUpload.path,
          download_url: legacyPdfUpload.publicUrl || legacyPdfUpload.signedUrl || null,
          expires_in: legacyPdfUpload.expiresIn,
        };
      }

      return res.status(200).json(responsePayload);
    } catch (uploadErr: any) {
      const reason = typeof uploadErr?.code === 'string' ? uploadErr.code : 'supabase_upload_failed';
      logger.error('shopify_create_product_supabase', uploadErr);
      const message = reason === 'supabase_credentials_missing'
        ? 'Faltan credenciales de Supabase'
        : 'supabase_upload_failed';
      return res.status(500).json({ ok: false, message, reason });
    }
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return res.status(status).json({ ok: false, message: e?.message || 'shopify_error' });
  }
}
