import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { shopifyAdmin, shopifyAdminGraphQL } from '../shopify.js';
import { buildProductUrl } from '../publicStorefront.js';
import { publishToOnlineStore, resolveOnlineStorePublicationId } from '../shopify/publication.js';
import { parseJsonBody } from '../_lib/http.js';
import { slugifyName } from '../_lib/slug.js';
import savePrintPdfToSupabase, { savePrintPreviewToSupabase } from '../_lib/savePrintPdfToSupabase.js';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import imageBufferToPdf from '../_lib/imageToPdf.js';
import logger from '../_lib/logger.js';
import { applyStubCors, buildStubRequestId, handleStubOptions, isStubEnabled, resolveFrontOrigin } from '../_lib/stubHelpers.js';

const DEFAULT_VENDOR = 'MgMGamers';
const OUTPUT_BUCKET = 'outputs';
const PUBLISH_PRODUCT_BODY_LIMIT = 6 * 1024 * 1024; // 6 MiB
const ONLINE_STORE_MISSING_MESSAGE = [
  'No pudimos encontrar el canal Online Store para publicar este producto.',
  'Revisá: 1) que el canal esté instalado, 2) que la app tenga el scope write_publications.',
  'Luego probá de nuevo.',
].join('\n');
const ONLINE_STORE_DISABLED_MESSAGE = 'Tu tienda no tiene el canal Online Store habilitado. Instalalo o bien omití la publicación y usa Storefront para el carrito.';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

const BANKERS_EPSILON = 1e-9;

function bankersRound(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) return null;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (diff > 0.5 + BANKERS_EPSILON) {
    return (floor + 1) / factor;
  }
  if (diff < 0.5 - BANKERS_EPSILON) {
    return floor / factor;
  }
  if (floor % 2 === 0) {
    return floor / factor;
  }
  return (floor + 1) / factor;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = bankersRound(value, 2);
  if (!Number.isFinite(rounded)) return null;
  return rounded.toFixed(2);
}

function pickProductType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'glasspad' || v === 'glass') {
    return { key: 'glasspad', label: 'Glasspad' };
  }
  return { key: 'mousepad', label: 'Mousepad' };
}

function formatDimension(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1).replace(/\.0+$/, '');
}

function formatNumberForKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/0$/, '');
}

function sanitizeMaterialForKey(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'material';
  const slug = slugifyName(raw);
  if (slug) return slug;
  return raw
    .normalize('NFD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
    || 'material';
}

function normalizeBackgroundHex(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '#ffffff';
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match) return '#ffffff';
  const hex = match[1];
  if (hex.length === 3) {
    return `#${hex.split('').map((c) => c + c).join('')}`;
  }
  return `#${hex}`;
}

function buildPrintsJobKey({ slug, widthCm, heightCm, material, backgroundColor, imageHash }) {
  const widthSegment = formatNumberForKey(widthCm);
  const heightSegment = formatNumberForKey(heightCm);
  return [
    slug || 'diseno',
    widthSegment,
    heightSegment,
    sanitizeMaterialForKey(material),
    (backgroundColor || '#ffffff').toLowerCase(),
    imageHash || 'hash',
  ].join('|');
}

function computeImageHash(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length) {
    return createHash('sha256').update(buffer).digest('hex');
  }
  if (buffer instanceof Uint8Array && buffer.length) {
    return createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  }
  return createHash('sha256').update('empty').digest('hex');
}

function buildMeasurement(widthCm, heightCm) {
  const w = formatDimension(widthCm);
  const h = formatDimension(heightCm);
  if (!w || !h) return null;
  return `${w}x${h}`;
}

const GLASSPAD_TRANSFER_PRICE = 120000;

const ROLLO_PRICING = {
  Pro: { width: 125, pricePerMeter: 36145, multiplier: 3.2, baselineArea: 0.26 },
  Clasic: { width: 140, pricePerMeter: 23820, multiplier: 2.7, baselineArea: 0.36 },
};

function mapCalculatorMaterial(material, productTypeKey) {
  if (productTypeKey === 'glasspad') return 'Glasspad';
  const raw = typeof material === 'string' ? material.trim().toLowerCase() : '';
  if (raw === 'pro') return 'Pro';
  if (raw === 'classic' || raw === 'clasic') return 'Clasic';
  if (raw === 'glasspad') return 'Glasspad';
  return '';
}

function roundToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return null;
  return Math.ceil(value / step) * step;
}

function calculateTransferPrice({ material, productTypeKey, widthCm, heightCm }) {
  const mode = mapCalculatorMaterial(material, productTypeKey);
  if (mode === 'Glasspad') {
    const transferPrice = GLASSPAD_TRANSFER_PRICE;
    return {
      transfer: transferPrice,
      normal: Math.round(transferPrice * 1.25),
    };
  }

  const rollo = ROLLO_PRICING[mode];
  if (!rollo) {
    return { transfer: 0, normal: 0 };
  }

  const normalizedWidthCm = isFiniteNumber(widthCm) ? widthCm : 0;
  const normalizedHeightCm = isFiniteNumber(heightCm) ? heightCm : 0;
  const pieceWidthM = normalizedWidthCm / 100;
  const pieceHeightM = normalizedHeightCm / 100;

  if (pieceWidthM <= 0 || pieceHeightM <= 0) {
    return { transfer: 0, normal: 0 };
  }

  const rolloWidthM = rollo.width / 100;
  const unitsHorizontal = Math.floor(rolloWidthM / pieceWidthM) * Math.floor(1 / pieceHeightM);
  const unitsRotated = Math.floor(rolloWidthM / pieceHeightM) * Math.max(Math.floor(1 / pieceWidthM), 1);
  const unitsPerMeter = Math.max(unitsHorizontal, unitsRotated, 1);
  const defaultPricePerUnit = rollo.pricePerMeter / unitsPerMeter;

  const useRotatedModel = !(pieceWidthM === 1.4 && pieceHeightM === 1)
    && pieceWidthM > 1
    && pieceWidthM < rolloWidthM;

  let finalCostPerUnit = defaultPricePerUnit;
  if (useRotatedModel) {
    const piecesPerRow = Math.max(Math.floor(rolloWidthM / pieceHeightM), 1);
    const baseCostPerUnit = rollo.pricePerMeter / piecesPerRow;
    const extraCost = ((pieceWidthM - 1) * rollo.pricePerMeter) / piecesPerRow;
    finalCostPerUnit = baseCostPerUnit + extraCost;
  }

  const yieldPrice = finalCostPerUnit * rollo.multiplier;
  const costPerM2 = rollo.pricePerMeter / rolloWidthM;
  const area = pieceWidthM * pieceHeightM;
  const areaPrice = area * costPerM2 * rollo.multiplier;

  let baseFinalPrice = Math.min(yieldPrice, areaPrice);

  const surchargeFactor = 5000;
  const extraArea = Math.max(0, area - rollo.baselineArea);
  const areaSurcharge = surchargeFactor * extraArea;

  if (normalizedWidthCm < 40 && normalizedHeightCm < 40) {
    baseFinalPrice *= 1.3;
  }

  const roundedBase = roundToStep(baseFinalPrice + areaSurcharge, 500) ?? 0;
  const clientFinalPrice = Math.round(roundedBase * 1.25);
  const transferBase = Math.round(clientFinalPrice * 0.8);
  const transferWithExtra = mode === 'Clasic' ? transferBase + 2000 : transferBase;
  const normalFromTransfer = Math.round(transferWithExtra / 0.8);

  return {
    transfer: transferWithExtra,
    normal: normalFromTransfer,
  };
}

function normalizeSkuSegment(raw, { allowX = false } = {}) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const normalized = trimmed
    .normalize('NFD')
    .replace(/[^\p{ASCII}]/gu, '')
    .toUpperCase();
  if (!normalized) return '';
  const pattern = allowX ? /[^A-Z0-9X]+/g : /[^A-Z0-9]+/g;
  return normalized.replace(pattern, allowX ? 'X' : '-').replace(/^-+|-+$/g, '');
}

function buildMeasurementSku(measurement) {
  if (typeof measurement !== 'string') return '';
  const trimmed = measurement.trim();
  if (!trimmed) return '';
  const sanitized = trimmed.toLowerCase().replace(/[^0-9x]+/g, 'x').replace(/x+/g, 'x').replace(/^x+|x+$/g, '');
  if (!sanitized) return '';
  return sanitized;
}

function buildGeneratedSku({ productTypeKey, measurement, materialLabel }) {
  const segments = ['MGM'];
  if (productTypeKey === 'glasspad') {
    segments.push('GLS');
  }
  const measurementSegment = buildMeasurementSku(measurement);
  if (measurementSegment) {
    segments.push(measurementSegment.toUpperCase());
  }
  const materialSegment = normalizeSkuSegment(materialLabel || '');
  if (materialSegment) {
    segments.push(materialSegment);
  }
  if (segments.length === 1) {
    segments.push('CUSTOM');
  }
  const sku = segments
    .filter((segment) => Boolean(segment))
    .join('-')
    .replace(/-+/g, '-');
  return sku.slice(0, 64);
}

function extractLegacyId(raw, expectedType = '') {
  if (raw == null) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }
  if (typeof raw === 'bigint') {
    return raw >= 0 ? raw.toString() : '';
  }
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const gidMatch = trimmed.match(/^gid:\/\/shopify\/([A-Za-z0-9]+)\/(\d+)$/);
  if (gidMatch) {
    if (!expectedType) return gidMatch[2];
    if (gidMatch[1].toLowerCase() === expectedType.toLowerCase()) return gidMatch[2];
    return gidMatch[2];
  }
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function buildInventoryItemGid(raw) {
  const legacy = extractLegacyId(raw, 'InventoryItem');
  return legacy ? `gid://shopify/InventoryItem/${legacy}` : '';
}

function buildGlasspadTitle({ designName, measurement }) {
  const sections = ['Glasspad'];
  const normalizedName = typeof designName === 'string' ? designName.trim() : '';
  if (normalizedName) sections.push(normalizedName);
  const normalizedMeasurement = typeof measurement === 'string' ? measurement.trim() : '';
  if (normalizedMeasurement) sections.push(normalizedMeasurement);
  return `${sections.join(' ')} | PERSONALIZADO`;
}

function buildDefaultTitle({ productTypeLabel, designName, measurement, materialLabel }) {
  const parts = [productTypeLabel];
  if (designName) parts.push(designName);
  if (measurement) parts.push(measurement);
  if (materialLabel) parts.push(materialLabel);
  return `${parts.join(' ')} | PERSONALIZADO`;
}

function buildMetaDescription({ productTypeLabel, designName, widthCm, heightCm, materialLabel }) {
  const measurement = buildMeasurement(widthCm, heightCm);
  const baseLabel = productTypeLabel === 'Glasspad'
    ? 'Glasspad gamer personalizado'
    : 'Mousepad gamer personalizado';
  const sections = [baseLabel];
  if (designName) sections.push(`Diseño ${designName}`);
  if (measurement) sections.push(`Medida ${measurement} cm`);
  if (materialLabel) sections.push(`Material ${materialLabel}`);
  return `${sections.join('. ')}.`;
}

function extractRequestId(resp) {
  if (!resp || typeof resp !== 'object' || typeof resp.headers?.get !== 'function') return '';
  return resp.headers.get('x-request-id') || resp.headers.get('X-Request-ID') || '';
}

function logRequestId(event, resp, extra = {}) {
  const requestId = extractRequestId(resp);
  if (requestId) {
    try {
      logger.debug(event, { requestId, ...extra });
    } catch {}
  }
  return requestId;
}

const RETRYABLE_SHOPIFY_STATUS = new Set([500, 502, 503, 504]);

const DEFAULT_SHOPIFY_API_VERSION = '2024-07';
const SHOP_SANITY_QUERY = `query ShopSanity {
  shop {
    name
    myshopifyDomain
  }
}`;

function pickEnvValue(names) {
  for (const name of names) {
    if (!name) continue;
    const raw = typeof process.env[name] === 'string' ? process.env[name].trim() : '';
    if (raw) return raw;
  }
  return '';
}

function isValidMyShopifyDomain(domain) {
  if (typeof domain !== 'string') return false;
  const trimmed = domain.trim();
  if (!trimmed) return false;
  if (!/\.myshopify\.com$/i.test(trimmed)) return false;
  const withoutSuffix = trimmed.replace(/\.myshopify\.com$/i, '');
  return /^[a-z0-9][a-z0-9-]*$/i.test(withoutSuffix);
}

function collectGraphQLErrorMessages(errors) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((err) => {
      if (!err || typeof err !== 'object') return '';
      if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
      if (typeof err.code === 'string' && err.code.trim()) return err.code.trim();
      if (typeof err?.extensions?.code === 'string' && err.extensions.code.trim()) {
        return err.extensions.code.trim();
      }
      return '';
    })
    .filter((msg) => Boolean(msg));
}

function formatGraphQLErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((err) => {
      if (!err || typeof err !== 'object') return null;
      const message = typeof err.message === 'string' ? err.message.trim() : '';
      const extensionsCode = typeof err?.extensions?.code === 'string'
        ? err.extensions.code.trim()
        : '';
      if (!message && !extensionsCode) return null;
      return {
        ...(message ? { message } : {}),
        ...(extensionsCode ? { extensionsCode } : {}),
      };
    })
    .filter(Boolean);
}

function sanitizeUserErrorField(field) {
  if (Array.isArray(field)) {
    const segments = field
      .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
      .filter(Boolean);
    return segments.length ? segments : undefined;
  }
  if (typeof field === 'string' && field.trim()) {
    return [field.trim()];
  }
  return undefined;
}

function sanitizeUserErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((err) => {
      if (!err || typeof err !== 'object') return null;
      const message = typeof err.message === 'string' ? err.message.trim() : '';
      const field = sanitizeUserErrorField(err.field);
      if (!message && !field) return null;
      return {
        ...(field ? { field } : {}),
        ...(message ? { message } : {}),
      };
    })
    .filter(Boolean);
}

async function ensureShopifyEnvironmentReady() {
  const domain = pickEnvValue(['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_SHOP']);
  const token = pickEnvValue(['SHOPIFY_ADMIN_TOKEN']);
  const rawApiVersion = typeof process.env.SHOPIFY_API_VERSION === 'string'
    ? process.env.SHOPIFY_API_VERSION.trim()
    : '';

  const missing = [];
  if (!domain) missing.push('SHOPIFY_SHOP');
  if (!token) missing.push('SHOPIFY_ADMIN_TOKEN');
  if (!rawApiVersion) missing.push('SHOPIFY_API_VERSION');

  if (missing.length) {
    return { ok: false, reason: 'missing_env', missing };
  }

  if (!isValidMyShopifyDomain(domain)) {
    return { ok: false, reason: 'invalid_shop_domain', domain };
  }

  if (!process.env.SHOPIFY_STORE_DOMAIN) {
    process.env.SHOPIFY_STORE_DOMAIN = domain;
  }
  if (!process.env.SHOPIFY_API_VERSION) {
    process.env.SHOPIFY_API_VERSION = rawApiVersion;
  }

  if (rawApiVersion !== DEFAULT_SHOPIFY_API_VERSION) {
    return { ok: false, reason: 'invalid_api_version', apiVersion: rawApiVersion };
  }

  let resp;
  try {
    resp = await shopifyAdminGraphQL(SHOP_SANITY_QUERY, {});
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      const errMissing = Array.isArray(err?.missing) && err.missing.length ? err.missing : missing;
      return { ok: false, reason: 'missing_env', missing: errMissing };
    }
    return { ok: false, reason: 'sanity_request_failed', error: err };
  }

  const requestId = logRequestId('shop_sanity_check', resp, { domain });
  const json = await resp.json().catch(() => null);

  if (!resp.ok) {
    const errors = Array.isArray(json?.errors) ? json.errors : [];
    return {
      ok: false,
      reason: 'sanity_http_error',
      status: resp.status,
      errors,
      json,
      requestId,
    };
  }

  const graphQLErrors = Array.isArray(json?.errors) ? json.errors : [];
  if (graphQLErrors.length) {
    return {
      ok: false,
      reason: 'sanity_graphql_errors',
      errors: graphQLErrors,
      requestId,
      messages: collectGraphQLErrorMessages(graphQLErrors),
    };
  }

  const shopName = typeof json?.data?.shop?.name === 'string' ? json.data.shop.name : '';
  if (!shopName) {
    return { ok: false, reason: 'sanity_no_shop', requestId };
  }

  return {
    ok: true,
    shopName,
    domain,
    apiVersion: rawApiVersion,
    requestId,
  };
}

async function executeProductCreate({ input, filename, maxAttempts = 3 }) {
  const attempts = [];
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await shopifyAdminGraphQL(PRODUCT_CREATE_MUTATION, { input });
      const requestId = logRequestId('product_create_request', resp, { filename, attempt: attempt + 1 });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      try {
        logger.warn('product_create_retry', {
          attempt: attempt + 1,
          status: resp.status,
          requestId: requestId || null,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      try {
        logger.warn('product_create_retry_error', {
          attempt: attempt + 1,
          message: err?.message || String(err),
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

async function executeProductStatusUpdate({ productId, status = 'ACTIVE', maxAttempts = 2 }) {
  const attempts = [];
  let lastError = null;
  const normalizedId = typeof productId === 'string' ? productId : '';
  if (!normalizedId) {
    throw new Error('product_status_update_missing_id');
  }
  const normalizedStatus = typeof status === 'string' && status
    ? status.toUpperCase()
    : 'ACTIVE';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const variables = { input: { id: normalizedId, status: normalizedStatus } };
      const resp = await shopifyAdminGraphQL(PRODUCT_STATUS_UPDATE_MUTATION, variables);
      const requestId = logRequestId('product_status_update_request', resp, {
        attempt: attempt + 1,
        productId: normalizedId,
      });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      try {
        logger.warn('product_status_update_retry', {
          attempt: attempt + 1,
          status: resp.status,
          requestId: requestId || null,
          productId: normalizedId,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      try {
        logger.warn('product_status_update_retry_error', {
          attempt: attempt + 1,
          message: err?.message || String(err),
          productId: normalizedId,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

function shouldUseBulkVariantUpdate(json) {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  return errors.some((error) => {
    const message = typeof error?.message === 'string' ? error.message : '';
    const code = typeof error?.extensions?.code === 'string' ? error.extensions.code : '';
    if (!message && !code) return false;
    const normalizedMessage = message.toLowerCase();
    return (
      code === 'undefinedField'
      || normalizedMessage.includes("field 'productvariantupdate' doesn't exist")
      || normalizedMessage.includes('productvariantupdate is not defined')
    );
  });
}

function buildBulkVariantUpdateVariables({ productId, input }) {
  const variant = {};
  if (typeof input?.id === 'string' && input.id) {
    variant.id = input.id;
  }
  if (typeof input?.price === 'string' && input.price) {
    variant.price = input.price;
  }
  if (typeof input?.sku === 'string' && input.sku) {
    variant.sku = input.sku;
  }
  if (typeof input?.taxable === 'boolean') {
    variant.taxable = input.taxable;
  }
  return {
    productId,
    variants: [variant],
  };
}

function normalizeBulkVariantUpdateJson(json) {
  if (!json || typeof json !== 'object') return json;
  const payload = json?.data?.productVariantsBulkUpdate;
  if (!payload || typeof payload !== 'object') return json;
  const productVariants = Array.isArray(payload.productVariants) ? payload.productVariants : [];
  const firstVariant = productVariants.find((variant) => variant && typeof variant === 'object') || null;
  const userErrors = Array.isArray(payload.userErrors) ? payload.userErrors : [];
  return {
    ...json,
    data: {
      ...json.data,
      productVariantUpdate: {
        productVariant: firstVariant,
        userErrors,
      },
    },
  };
}

async function executeProductVariantUpdate({ input, productId, maxAttempts = 3 }) {
  const attempts = [];
  let lastError = null;
  let useBulkMutation = false;

  for (let attempt = 0; attempt < maxAttempts;) {
    attempt += 1;
    const attemptIndex = attempt - 1;
    const variantId = typeof input?.id === 'string' ? input.id : undefined;
    const mutation = useBulkMutation ? PRODUCT_VARIANTS_BULK_UPDATE_MUTATION : PRODUCT_VARIANT_UPDATE_MUTATION;
    const variables = useBulkMutation
      ? buildBulkVariantUpdateVariables({ productId, input })
      : { input };
    const eventName = useBulkMutation
      ? 'product_variants_bulk_update_request'
      : 'product_variant_update_request';

    try {
      const resp = await shopifyAdminGraphQL(mutation, variables);
      const requestId = logRequestId(eventName, resp, {
        attempt,
        variantId,
        ...(useBulkMutation && typeof productId === 'string' ? { productId } : {}),
      });
      const rawJson = await resp.json().catch(() => null);
      const json = useBulkMutation ? normalizeBulkVariantUpdateJson(rawJson) : rawJson;
      const attemptInfo = { resp, json, requestId, mode: useBulkMutation ? 'bulk' : 'single' };
      attempts.push(attemptInfo);

      if (
        !useBulkMutation
        && typeof variantId === 'string'
        && variantId
        && shouldUseBulkVariantUpdate(json)
        && typeof productId === 'string'
        && productId
      ) {
        useBulkMutation = true;
        continue;
      }

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt >= maxAttempts) {
        return { ...attemptInfo, attempts };
      }

      try {
        logger.warn('product_variant_update_retry', {
          attempt,
          status: resp.status,
          requestId: requestId || null,
          variantId,
          mode: attemptInfo.mode,
        });
      } catch {}

      await sleep(200 * 2 ** attemptIndex);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt >= maxAttempts) {
        throw err;
      }

      try {
        logger.warn('product_variant_update_retry_error', {
          attempt,
          message: err?.message || String(err),
          variantId,
          mode: useBulkMutation ? 'bulk' : 'single',
        });
      } catch {}

      await sleep(200 * 2 ** attemptIndex);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

function buildVariantFromRestVariant(defaultVariant, restVariant, updateInput) {
  const base = defaultVariant && typeof defaultVariant === 'object' ? defaultVariant : {};
  const rest = restVariant && typeof restVariant === 'object' ? restVariant : {};
  const adminId = typeof rest.admin_graphql_api_id === 'string'
    ? rest.admin_graphql_api_id
    : typeof base.id === 'string'
      ? base.id
      : null;
  const legacyId = extractLegacyId(rest.id ?? rest.legacyResourceId ?? base.legacyResourceId ?? base.id, 'ProductVariant');
  const price = typeof rest.price === 'string' && rest.price
    ? rest.price
    : typeof updateInput?.price === 'string'
      ? updateInput.price
      : typeof base.price === 'string'
        ? base.price
        : null;
  const sku = typeof rest.sku === 'string' && rest.sku
    ? rest.sku
    : typeof updateInput?.sku === 'string'
      ? updateInput.sku
      : typeof base.sku === 'string'
        ? base.sku
        : null;
  const inventoryPolicyRaw = typeof rest.inventory_policy === 'string'
    ? rest.inventory_policy.trim().toUpperCase()
    : typeof base.inventoryPolicy === 'string'
      ? base.inventoryPolicy
      : null;
  const availableForSaleRaw = typeof rest.available === 'boolean'
    ? rest.available
    : typeof rest.available_for_sale === 'boolean'
      ? rest.available_for_sale
      : typeof base.availableForSale === 'boolean'
        ? base.availableForSale
        : null;
  const inventoryItemId = typeof base?.inventoryItem?.id === 'string'
    ? base.inventoryItem.id
    : buildInventoryItemGid(rest.inventory_item_id);

  const variant = {
    id: adminId,
    legacyResourceId: legacyId || undefined,
    title: typeof base.title === 'string' ? base.title : typeof rest.title === 'string' ? rest.title : null,
    price: price || null,
    sku: sku || null,
  };
  if (inventoryPolicyRaw) {
    variant.inventoryPolicy = inventoryPolicyRaw;
  }
  if (availableForSaleRaw != null) {
    variant.availableForSale = Boolean(availableForSaleRaw);
  }
  if (inventoryItemId) {
    variant.inventoryItem = { id: inventoryItemId };
  }
  return variant;
}

async function executeProductVariantRestUpdate({ variantId, payload, maxAttempts = 3 }) {
  const attempts = [];
  let lastError = null;
  const legacyId = extractLegacyId(variantId, 'ProductVariant');
  if (!legacyId) {
    throw new Error('variant_rest_id_invalid');
  }
  const variantPayload = {
    id: Number.isFinite(Number(legacyId)) ? Number(legacyId) : legacyId,
    price: payload?.price,
    taxable: payload?.taxable === true,
    inventory_policy: 'continue',
    inventory_management: null,
  };
  if (typeof payload?.sku === 'string' && payload.sku) {
    variantPayload.sku = payload.sku;
  }
  const body = JSON.stringify({ variant: variantPayload });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await shopifyAdmin(`variants/${legacyId}.json`, { method: 'PUT', body });
      const requestId = logRequestId('product_variant_update_rest_request', resp, {
        attempt: attempt + 1,
        variantId: legacyId,
      });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      try {
        logger.warn('product_variant_update_rest_retry', {
          attempt: attempt + 1,
          status: resp.status,
          requestId: requestId || null,
          variantId: legacyId,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      try {
        logger.warn('product_variant_update_rest_retry_error', {
          attempt: attempt + 1,
          message: err?.message || String(err),
          variantId: legacyId,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

async function executeProductVariantQuery({ productId, first = 1, maxAttempts = 3 }) {
  const attempts = [];
  let lastError = null;
  const variables = {
    id: productId,
    first: Math.max(1, Number.isFinite(first) ? Number(first) : 1),
  };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await shopifyAdminGraphQL(PRODUCT_VARIANT_QUERY, variables);
      const requestId = logRequestId('product_variant_query_request', resp, {
        productId,
        attempt: attempt + 1,
      });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      try {
        logger.warn('product_variant_query_retry', {
          attempt: attempt + 1,
          status: resp.status,
          requestId: requestId || null,
          productId,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      try {
        logger.warn('product_variant_query_retry_error', {
          attempt: attempt + 1,
          message: err?.message || String(err),
          productId,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

async function executeProductCreateMedia({ productId, media, maxAttempts = 3 }) {
  const attempts = [];
  let lastError = null;
  const variables = { productId, media };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await shopifyAdminGraphQL(PRODUCT_CREATE_MEDIA_MUTATION, variables);
      const requestId = logRequestId('product_create_media_request', resp, { productId, attempt: attempt + 1 });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      try {
        logger.warn('product_create_media_retry', {
          attempt: attempt + 1,
          status: resp.status,
          requestId: requestId || null,
          productId,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      try {
        logger.warn('product_create_media_retry_error', {
          attempt: attempt + 1,
          message: err?.message || String(err),
          productId,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

async function executeLocationsQuery({ first = 5, maxAttempts = 3 } = {}) {
  const attempts = [];
  let lastError = null;
  const variables = { first: Math.max(1, Number.isFinite(first) ? Number(first) : 5) };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await shopifyAdminGraphQL(LOCATIONS_QUERY, variables);
      const requestId = logRequestId('locations_query_request', resp, { attempt: attempt + 1 });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      try {
        logger.warn('locations_query_retry', {
          attempt: attempt + 1,
          status: resp.status,
          requestId: requestId || null,
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      try {
        logger.warn('locations_query_retry_error', {
          attempt: attempt + 1,
          message: err?.message || String(err),
        });
      } catch {}

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

async function executeInventoryItemUpdate({ id, input, maxAttempts = 3 }) {
  const attempts = [];
  let lastError = null;
  const variables = { id, input };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await shopifyAdminGraphQL(INVENTORY_ITEM_UPDATE_MUTATION, variables);
      const requestId = logRequestId('inventory_item_update_request', resp, {
        attempt: attempt + 1,
      });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

async function executeInventorySetOnHandQuantities({ input, maxAttempts = 3 }) {
  const attempts = [];
  let lastError = null;
  const variables = { input };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await shopifyAdminGraphQL(INVENTORY_SET_ON_HAND_QUANTITIES_MUTATION, variables);
      const requestId = logRequestId('inventory_set_on_hand_request', resp, {
        attempt: attempt + 1,
      });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

async function executeInventoryLevelsSet({ inventoryItemId, locationId, available, maxAttempts = 3 }) {
  const itemLegacyId = extractLegacyId(inventoryItemId, 'InventoryItem');
  const locationLegacyId = extractLegacyId(locationId, 'Location');
  if (!itemLegacyId || !locationLegacyId) {
    throw new Error('inventory_level_rest_id_invalid');
  }
  const numericAvailable = Number.isFinite(Number(available)) ? Math.trunc(Number(available)) : Number(available);
  const payload = {
    location_id: Number(locationLegacyId),
    inventory_item_id: Number(itemLegacyId),
    available: numericAvailable,
  };
  const body = JSON.stringify(payload);

  const attempts = [];
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await shopifyAdmin('inventory_levels/set.json', { method: 'POST', body });
      const requestId = logRequestId('inventory_levels_set_request', resp, {
        attempt: attempt + 1,
        locationId: locationLegacyId,
        inventoryItemId: itemLegacyId,
      });
      const json = await resp.json().catch(() => null);
      const attemptInfo = { resp, json, requestId };
      attempts.push(attemptInfo);

      if (resp.ok) {
        return { ...attemptInfo, attempts };
      }

      if (!RETRYABLE_SHOPIFY_STATUS.has(resp.status) || attempt === maxAttempts - 1) {
        return { ...attemptInfo, attempts };
      }

      await sleep(200 * 2 ** attempt);
    } catch (err) {
      lastError = err;
      attempts.push({ error: err });

      if (attempt === maxAttempts - 1) {
        throw err;
      }

      await sleep(200 * 2 ** attempt);
    }
  }

  if (lastError) throw lastError;
  return attempts[attempts.length - 1];
}

function parseDataUrlMeta(dataUrl) {
  if (typeof dataUrl !== 'string') {
    return { mimeType: 'image/png' };
  }
  const match = /^data:([^;,]+)(;base64)?,/.exec(dataUrl);
  if (!match) {
    return { mimeType: 'image/png' };
  }
  const mimeType = match[1] ? match[1].trim() : 'image/png';
  return { mimeType: mimeType || 'image/png' };
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : [];
  const result = [];
  const seen = new Set();
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const normalized = trimmed.slice(0, 60);
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    result.push(normalized);
    if (result.length >= 45) break;
  }
  return result;
}

const STAGED_UPLOADS_CREATE_MUTATION = `mutation StagedUploads($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters {
        name
        value
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const PRODUCT_CREATE_MUTATION = `mutation ProductCreate($input: ProductInput!) {
  productCreate(input: $input) {
    product {
      id
      legacyResourceId
      handle
      status
      variants(first: 5) {
        nodes {
          id
          legacyResourceId
          title
          inventoryItem {
            id
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const PRODUCT_STATUS_UPDATE_MUTATION = `mutation ProductStatusUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product {
      id
      legacyResourceId
      handle
      status
    }
    userErrors {
      field
      message
    }
  }
}`;

const PRODUCT_METAFIELDS_SET_MUTATION = `mutation ProductMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      type
      value
    }
    userErrors {
      field
      message
    }
  }
}`;

const PRODUCT_VARIANT_UPDATE_MUTATION = `mutation ProductVariantUpdate($input: ProductVariantInput!) {
  productVariantUpdate(input: $input) {
    productVariant {
      id
      legacyResourceId
      title
      price
      sku
      availableForSale
      inventoryPolicy
      inventoryItem {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `mutation ProductVariantsBulkUpdate(
  $productId: ID!
  $variants: [ProductVariantsBulkInput!]!
) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      legacyResourceId
      title
      price
      sku
      availableForSale
      inventoryPolicy
      inventoryItem {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const PRODUCT_VARIANT_QUERY = `query ProductDefaultVariant($id: ID!, $first: Int!) {
  product(id: $id) {
    id
    variants(first: $first) {
      nodes {
        id
        legacyResourceId
        title
        sku
        inventoryItem {
          id
        }
      }
    }
  }
}`;

const PRODUCT_CREATE_MEDIA_MUTATION = `mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media {
      id
      status
      alt
      mediaErrors {
        code
        message
        details
      }
    }
    mediaUserErrors {
      field
      message
      code
    }
  }
}`;

const LOCATIONS_QUERY = `query PrimaryLocations($first: Int!) {
  locations(first: $first) {
    nodes {
      id
      name
      isActive
      isPrimary
    }
  }
}`;

const INVENTORY_ITEM_UPDATE_MUTATION = `mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
  inventoryItemUpdate(id: $id, input: $input) {
    inventoryItem {
      id
      tracked
    }
    userErrors {
      field
      message
    }
  }
}`;

const INVENTORY_SET_ON_HAND_QUANTITIES_MUTATION = `mutation InventorySetOnHandQuantities($input: InventorySetOnHandQuantitiesInput!) {
  inventorySetOnHandQuantities(input: $input) {
    inventoryAdjustmentGroup {
      id
    }
    userErrors {
      field
      message
    }
  }
}`;

async function stagedUploadImage({ filename, buffer, mimeType, maxUploadAttempts = 3 }) {
  if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
    throw new Error('staged_upload_empty_buffer');
  }
  const input = [{
    resource: 'IMAGE',
    filename,
    mimeType: mimeType || 'image/png',
    fileSize: String(buffer.length),
    httpMethod: 'POST',
  }];
  const resp = await shopifyAdminGraphQL(STAGED_UPLOADS_CREATE_MUTATION, { input });
  const requestId = logRequestId('staged_upload_request', resp, { filename });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error('staged_upload_request_failed');
    err.status = resp.status;
    err.body = json;
    err.requestId = requestId;
    throw err;
  }
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  if (errors.length) {
    const formattedErrors = formatGraphQLErrors(errors);
    try {
      logger.error('staged_upload_graphql_errors', {
        requestId: requestId || null,
        errors: formattedErrors,
      });
    } catch {}
    const err = new Error('staged_upload_graphql_errors');
    err.errors = formattedErrors;
    err.requestId = requestId;
    throw err;
  }
  const payload = json?.data?.stagedUploadsCreate;
  const userErrors = sanitizeUserErrors(payload?.userErrors);
  if (userErrors.length) {
    try {
      logger.error('staged_upload_user_errors', {
        requestId: requestId || null,
        userErrors,
      });
    } catch {}
    const err = new Error('staged_upload_user_errors');
    err.userErrors = userErrors;
    err.requestId = requestId;
    throw err;
  }
  const target = Array.isArray(payload?.stagedTargets) ? payload.stagedTargets[0] : null;
  if (!target?.url || !target?.resourceUrl) {
    const err = new Error('staged_upload_target_missing');
    err.requestId = requestId;
    throw err;
  }

  const parameters = Array.isArray(target.parameters) ? target.parameters : [];
  const blob = new Blob([buffer], { type: mimeType || 'image/png' });
  const buildFormData = () => {
    const formData = new FormData();
    for (const param of parameters) {
      if (!param || typeof param !== 'object') continue;
      const name = typeof param.name === 'string' ? param.name : '';
      if (!name) continue;
      const value = typeof param.value === 'string' ? param.value : '';
      formData.append(name, value);
    }
    formData.append('file', blob, filename);
    return formData;
  };

  const attempts = Math.max(1, Number.isFinite(maxUploadAttempts) ? Number(maxUploadAttempts) : 3);
  let uploadRequestId = '';
  let lastStatus = 0;
  let lastBody = '';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const form = buildFormData();
    let uploadResp;
    try {
      uploadResp = await fetch(target.url, { method: 'POST', body: form });
    } catch (err) {
      lastStatus = 0;
      lastBody = err?.message || '';
      if (attempt < attempts - 1) {
        try {
          logger.warn('staged_upload_post_retry', {
            attempt: attempt + 1,
            status: 0,
            requestId: requestId || null,
            uploadRequestId: uploadRequestId || null,
            reason: err?.message || 'exception',
          });
        } catch {}
        await sleep(200 * 2 ** attempt);
        continue;
      }
      const finalErr = new Error('staged_upload_failed');
      finalErr.status = 0;
      finalErr.body = lastBody;
      finalErr.requestId = requestId;
      finalErr.attempt = attempt + 1;
      throw finalErr;
    }

    const attemptUploadRequestId = extractRequestId(uploadResp);
    if (attemptUploadRequestId) {
      uploadRequestId = attemptUploadRequestId;
    }

    if (uploadResp.ok) {
      try {
        logger.debug('staged_upload_success', {
          requestId,
          uploadRequestId: uploadRequestId || null,
          filename,
          attempts: attempt + 1,
        });
      } catch {}
      return { originalSource: target.resourceUrl, requestId, uploadRequestId: uploadRequestId || null };
    }

    lastStatus = uploadResp.status;
    const text = await uploadResp.text().catch(() => '');
    lastBody = text.slice(0, 2000);

    if (uploadResp.status >= 500 && uploadResp.status < 600 && attempt < attempts - 1) {
      try {
        logger.warn('staged_upload_post_retry', {
          attempt: attempt + 1,
          status: uploadResp.status,
          requestId: requestId || null,
          uploadRequestId: uploadRequestId || null,
        });
      } catch {}
      await sleep(200 * 2 ** attempt);
      continue;
    }

    const err = new Error('staged_upload_failed');
    err.status = uploadResp.status;
    err.body = lastBody;
    err.requestId = requestId;
    if (uploadRequestId) err.uploadRequestId = uploadRequestId;
    err.attempt = attempt + 1;
    throw err;
  }

  const err = new Error('staged_upload_failed');
  err.status = lastStatus || 502;
  err.body = lastBody;
  err.requestId = requestId;
  if (uploadRequestId) err.uploadRequestId = uploadRequestId;
  err.attempt = attempts;
  throw err;
}

function buildProductMeta(product, variant) {
  const handle = typeof product?.handle === 'string' ? product.handle : undefined;
  const productUrl = handle ? buildProductUrl(handle) : undefined;
  const productAdminId = typeof product?.admin_graphql_api_id === 'string'
    ? product.admin_graphql_api_id
    : typeof product?.id === 'string'
      ? product.id
      : undefined;
  const variantAdminId = typeof variant?.admin_graphql_api_id === 'string'
    ? variant.admin_graphql_api_id
    : typeof variant?.id === 'string'
      ? variant.id
      : undefined;
  const productLegacyId = product?.legacyResourceId ?? product?.legacy_resource_id ?? product?.id;
  const variantLegacyId = variant?.legacyResourceId ?? variant?.legacy_resource_id ?? variant?.id;
  const productId = productLegacyId != null ? String(productLegacyId) : productAdminId;
  const variantId = variantLegacyId != null ? String(variantLegacyId) : variantAdminId;
  return {
    productId,
    productHandle: handle,
    productUrl,
    productAdminId,
    variantId,
    variantAdminId,
  };
}

function pickPrimaryLocation(locations) {
  if (!Array.isArray(locations)) return null;
  const nodes = locations
    .map((loc) => (loc && typeof loc === 'object' ? loc : null))
    .filter(Boolean);
  if (!nodes.length) return null;
  const activeNodes = nodes.filter((loc) => loc.isActive !== false);
  if (activeNodes.length) {
    const primary = activeNodes.find((loc) => loc.isPrimary === true);
    if (primary) return primary;
    return activeNodes[0];
  }
  const primaryInactive = nodes.find((loc) => loc.isPrimary === true);
  return primaryInactive || nodes[0];
}

function respondWithPublicationIssue(res, meta, reason, message, options = {}) {
  const payload = {
    ok: false,
    reason,
    message,
    recoverable: true,
    retryable: true,
    allowSkipPublication: Boolean(options.allowSkipPublication),
    publicationId: options.publicationId || null,
    publicationSource: options.publicationSource || null,
    ...meta,
  };
  if (Array.isArray(options.missing) && options.missing.length) {
    payload.missing = options.missing;
  }
  if (Array.isArray(options.publishAttempts)) {
    payload.publishAttempts = options.publishAttempts.length;
    payload.requestIds = options.publishAttempts.filter(Boolean);
  } else if (Array.isArray(options.requestIds)) {
    payload.requestIds = options.requestIds.filter(Boolean);
  }
  return res.status(200).json(payload);
}

function logPublicationAbort(meta, cause, extra = {}) {
  try {
    logger.warn('publish_product_publication_abort', {
      cause,
      productId: meta?.productId || null,
      variantId: meta?.variantId || null,
      ...extra,
    });
  } catch {}
}

function isActiveStatus(product) {
  const raw = typeof product?.status === 'string' ? product.status.trim().toUpperCase() : '';
  return raw === 'ACTIVE';
}

function hasVariant(product) {
  if (!product || typeof product !== 'object') return false;
  if (Array.isArray(product?.variants)) {
    const legacyVariants = product.variants;
    return legacyVariants.length > 0 && legacyVariants[0] && typeof legacyVariants[0] === 'object';
  }
  const nodes = Array.isArray(product?.variants?.nodes) ? product.variants.nodes : [];
  return nodes.length > 0 && nodes[0] && typeof nodes[0] === 'object';
}

function detectMissingScope(errorDetail) {
  const list = Array.isArray(errorDetail) ? errorDetail : [];
  return list.some((err) => {
    const code = typeof err?.code === 'string' ? err.code.toUpperCase()
      : typeof err?.extensions?.code === 'string' ? err.extensions.code.toUpperCase()
        : typeof err?.extensionsCode === 'string' ? err.extensionsCode.toUpperCase()
          : '';
    if (code.includes('ACCESS') || code.includes('PERMISSION')) return true;
    const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
    if (!message) return false;
    return message.includes('permission') || message.includes('scope') || message.includes('access');
  });
}

function extractScopesFromString(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  const matches = raw.toLowerCase().match(/\b(?:read|write)_[a-z0-9_]+\b/g);
  if (!matches) return [];
  return matches.map((scope) => scope.trim()).filter(Boolean);
}

function collectMissingScopes(detail) {
  const list = Array.isArray(detail) ? detail : [];
  const scopes = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const candidates = [
      typeof entry.message === 'string' ? entry.message : '',
      typeof entry.code === 'string' ? entry.code : '',
      typeof entry?.extensions?.code === 'string' ? entry.extensions.code : '',
      typeof entry?.extensionsCode === 'string' ? entry.extensionsCode : '',
    ];
    if (Array.isArray(entry?.extensions?.requiredAccess)) {
      for (const access of entry.extensions.requiredAccess) {
        if (typeof access === 'string') candidates.push(access);
      }
    }
    for (const candidate of candidates) {
      if (!candidate) continue;
      for (const scope of extractScopesFromString(candidate)) {
        scopes.add(scope);
      }
    }
  }
  return Array.from(scopes);
}

function isMissingFilesScopeMessage(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const normalized = raw.toLowerCase();
  if (!normalized.includes('scope') && !normalized.includes('permission') && !normalized.includes('access')) {
    return normalized.includes('write_files');
  }
  return normalized.includes('write_files')
    || normalized.includes('write files')
    || normalized.includes('stagedupload')
    || normalized.includes('staged uploads');
}

function detectMissingFilesScope(detail) {
  if (!detail) return false;
  if (detectMissingScope(detail)) return true;
  const list = Array.isArray(detail) ? detail : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    if (isMissingFilesScopeMessage(entry?.message)) return true;
    if (isMissingFilesScopeMessage(entry?.code)) return true;
    if (isMissingFilesScopeMessage(entry?.extensions?.code)) return true;
    if (isMissingFilesScopeMessage(entry?.extensionsCode)) return true;
  }
  return false;
}

export async function publishProduct(req, res) {
  if (handleStubOptions(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }

  if (isStubEnabled()) {
    applyStubCors(res);
    const rid = buildStubRequestId();
    const origin = resolveFrontOrigin();
    const productUrl = `${origin}/mockup?rid=${rid}&from=publish`;
    return res.status(200).json({
      ok: true,
      stub: true,
      productId: `mock_${rid}`,
      variantId: `mock_var_${rid}`,
      productHandle: 'mock-product',
      visibility: 'public',
      warnings: [],
      warningMessages: [],
      productUrl,
      url: productUrl,
    });
  }

  try {
    const envStatus = await ensureShopifyEnvironmentReady();
    if (!envStatus.ok) {
      const reason = envStatus.reason || 'shopify_env_invalid';
      let message = 'Token/Admin API inválido o dominio incorrecto';
      if (reason === 'invalid_api_version') {
        message = `La versión de la API de Shopify debe ser ${DEFAULT_SHOPIFY_API_VERSION}.`;
      }
      try {
        logger.error('shopify_env_check_failed', {
          reason,
          requestId: envStatus.requestId || null,
          missing: Array.isArray(envStatus.missing) ? envStatus.missing : undefined,
          status: typeof envStatus.status === 'number' ? envStatus.status : undefined,
          messages: Array.isArray(envStatus.messages) ? envStatus.messages : undefined,
        });
      } catch {}
      return res.status(400).json({
        ok: false,
        reason,
        message,
        ...(envStatus.requestId ? { requestId: envStatus.requestId } : {}),
        ...(typeof envStatus.status === 'number' ? { status: envStatus.status } : {}),
        ...(Array.isArray(envStatus.missing) && envStatus.missing.length ? { missing: envStatus.missing } : {}),
        ...(Array.isArray(envStatus.errors) && envStatus.errors.length ? { errors: envStatus.errors } : {}),
        ...(Array.isArray(envStatus.messages) && envStatus.messages.length ? { messages: envStatus.messages } : {}),
      });
    }

    let body;
    try {
      body = await parseJsonBody(req, { limit: PUBLISH_PRODUCT_BODY_LIMIT });
    } catch (err) {
      const code = err?.code === 'payload_too_large' ? 'payload_too_large'
        : err?.code === 'invalid_json' ? 'invalid_body'
          : 'invalid_body';
      const status = err?.code === 'payload_too_large' ? 413 : 400;
      const message = err?.code === 'payload_too_large'
        ? 'El mockup es demasiado grande. Probá de nuevo con una imagen más liviana.'
        : 'El cuerpo de la petición es inválido.';
      return res.status(status).json({ ok: false, reason: code, message });
    }
    body = body && typeof body === 'object' ? body : {};

    const mockupDataUrl = typeof body.mockupDataUrl === 'string' ? body.mockupDataUrl : '';
    const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'mockup.png';
    const warnings = [];
    let variantInventoryMode = 'not_tracked';
    let variantAvailableForSale = null;

    if (!mockupDataUrl) {
      return res.status(400).json({ ok: false, reason: 'missing_mockup_dataurl' });
    }
    const b64 = (mockupDataUrl.split(',')[1] || '').trim();
    if (!b64) return res.status(400).json({ ok: false, reason: 'invalid_mockup_dataurl' });

    const designNameRaw = typeof body.designName === 'string' ? body.designName.trim() : '';
    const { key: productTypeKey, label: productTypeLabel } = pickProductType(body.productType);
    const approxDpi = toNumber(body.approxDpi ?? body.approx_dpi);
    const widthCm = toNumber(body.widthCm ?? body.width_cm);
    const heightCm = toNumber(body.heightCm ?? body.height_cm);
    const measurementLabel = buildMeasurement(widthCm, heightCm);
    const materialRaw = typeof body.material === 'string' ? body.material.trim() : '';
    const materialLabel = materialRaw || (productTypeKey === 'glasspad' ? 'Glasspad' : '');

    const baseTitle = typeof body.title === 'string' ? body.title.trim() : '';
    const fallbackTitle = productTypeKey === 'glasspad'
      ? buildGlasspadTitle({ designName: designNameRaw, measurement: measurementLabel })
      : buildDefaultTitle({
        productTypeLabel,
        designName: designNameRaw,
        measurement: measurementLabel,
        materialLabel,
      });
    const title = (baseTitle || fallbackTitle).slice(0, 254);
    const designNameForPdf = designNameRaw || title;

    const requestedPriceTransfer = toNumber(body.priceTransfer ?? body.price);
    const calculatorPricing = calculateTransferPrice({
      material: materialLabel || materialRaw,
      productTypeKey,
      widthCm,
      heightCm,
    });

    let priceTransfer = requestedPriceTransfer;
    let priceTransferSource = 'request';

    if (!isFiniteNumber(priceTransfer) || priceTransfer <= 0) {
      if (isFiniteNumber(calculatorPricing?.transfer) && calculatorPricing.transfer > 0) {
        priceTransfer = calculatorPricing.transfer;
        priceTransferSource = 'calculator';
      } else {
        priceTransfer = 0;
        priceTransferSource = 'missing';
      }
    }
    const visibilityRaw = typeof body.visibility === 'string' ? body.visibility.trim().toLowerCase() : '';
    const isPrivateExplicit = typeof body.isPrivate === 'boolean' ? body.isPrivate : null;
    const visibility = isPrivateExplicit === true || visibilityRaw === 'private' || visibilityRaw === 'draft'
      ? 'private'
      : 'public';
    const modeRaw = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';
    const mode = modeRaw === 'private' || modeRaw === 'draft'
      ? 'private'
      : modeRaw === 'public'
        ? 'public'
        : visibility;
    const isPrivate = visibility === 'private';

    const imageAlt = typeof body.imageAlt === 'string' && body.imageAlt.trim()
      ? body.imageAlt.trim().slice(0, 254)
      : title;

    const { mimeType } = parseDataUrlMeta(mockupDataUrl);
    const imageBuffer = Buffer.from(b64, 'base64');
    if (!imageBuffer.length) {
      return res.status(400).json({ ok: false, reason: 'invalid_mockup_dataurl' });
    }

    let stagedImage;
    try {
      stagedImage = await stagedUploadImage({ filename, buffer: imageBuffer, mimeType });
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 502;
      const formattedErrors = Array.isArray(err?.errors) && err.errors.length
        ? err.errors
        : formatGraphQLErrors(err?.body?.errors);
      const stagedUserErrors = Array.isArray(err?.userErrors) && err.userErrors.length
        ? err.userErrors
        : sanitizeUserErrors(err?.body?.userErrors);
      const combined = [
        ...(Array.isArray(formattedErrors) ? formattedErrors : []),
        ...(Array.isArray(stagedUserErrors) ? stagedUserErrors : []),
      ];
      const extraMessages = [
        typeof err?.message === 'string' ? err.message : '',
        typeof err?.body === 'string' ? err.body : '',
        typeof err?.body?.message === 'string' ? err.body.message : '',
      ];
      const missingFilesScope = detectMissingFilesScope(combined)
        || extraMessages.some((msg) => isMissingFilesScopeMessage(msg));

      const stageRequestId = err?.requestId || null;
      const uploadRequestId = err?.uploadRequestId || null;

      const warningBase = {
        code: missingFilesScope ? 'missing_write_files_scope' : 'image_upload_failed',
        status,
        requestId: stageRequestId,
        uploadRequestId,
        detail: formattedErrors?.length || stagedUserErrors?.length
          ? {
            ...(formattedErrors?.length ? { errors: formattedErrors } : {}),
            ...(stagedUserErrors?.length ? { userErrors: stagedUserErrors } : {}),
          }
          : err?.body || null,
      };

      const message = missingFilesScope
        ? 'No se pudo subir la imagen porque falta el scope write_files. Se seguirá sin mockup.'
        : 'No se pudo subir la imagen, se seguirá sin mockup.';

      const warningPayload = {
        ...warningBase,
        message,
        ...(missingFilesScope ? { missing: ['write_files'] } : {}),
      };

      warnings.push(warningPayload);

      try {
        logger.warn('product_image_upload_warning', {
          message,
          status,
          requestId: stageRequestId,
          uploadRequestId,
          missingFilesScope,
          attempt: typeof err?.attempt === 'number' ? err.attempt : null,
          errors: Array.isArray(formattedErrors) && formattedErrors.length ? formattedErrors : undefined,
          userErrors: Array.isArray(stagedUserErrors) && stagedUserErrors.length ? stagedUserErrors : undefined,
        });
      } catch {}

      stagedImage = null;
    }


    const basePrice = isFiniteNumber(priceTransfer) ? Math.max(priceTransfer, 0) : 0;
    const computedPrice = basePrice;
    const priceValue = formatMoney(computedPrice) || '0.00';

    const variantUpdateInputBase = {
      price: priceValue,
      taxable: true,
      inventoryPolicy: 'CONTINUE',
      inventoryManagement: null,
    };

    try {
      logger.debug('variant_price_computed', {
        priceTransfer: priceTransfer || null,
        priceTransferSource,
        requestedPriceTransfer: isFiniteNumber(requestedPriceTransfer)
          ? requestedPriceTransfer
          : null,
        calculatorTransfer: isFiniteNumber(calculatorPricing?.transfer)
          ? calculatorPricing.transfer
          : null,
        calculatorNormal: isFiniteNumber(calculatorPricing?.normal)
          ? calculatorPricing.normal
          : null,
        basePrice,
        computedPrice,
        priceValue,
        isPrivate,
      });
    } catch {}

    let primaryLocationId = null;
    let primaryLocationName = '';
    let locationRequestIds = [];
    let lastLocationRequestId = null;

    try {
      const {
        resp: locationResp,
        json: locationJson,
        requestId: locationRequestId,
        attempts: locationAttempts,
      } = await executeLocationsQuery({ first: 5 });

      lastLocationRequestId = locationRequestId || null;
      locationRequestIds = Array.isArray(locationAttempts)
        ? locationAttempts.map((entry) => entry?.requestId).filter(Boolean)
        : [];

      if (!locationResp.ok) {
        return res.status(502).json({
          ok: false,
          reason: 'shopify_error',
          status: locationResp.status,
          body: locationJson,
          requestId: lastLocationRequestId,
          ...(locationRequestIds.length ? { requestIds: locationRequestIds } : {}),
          message: 'Shopify devolvió un error al obtener las ubicaciones de la tienda.',
        });
      }

      const locationErrors = Array.isArray(locationJson?.errors) ? locationJson.errors : [];
      const formattedLocationErrors = formatGraphQLErrors(locationErrors);
      const locationNodes = Array.isArray(locationJson?.data?.locations?.nodes)
        ? locationJson.data.locations.nodes
        : [];
      const primaryLocation = pickPrimaryLocation(locationNodes);

      if (locationErrors.length && !primaryLocation) {
        if (detectMissingScope(locationErrors)) {
          const missingScopes = collectMissingScopes(locationErrors);
          const missing = missingScopes.length ? missingScopes : ['read_locations'];
          const friendlyMessage = missing.length
            ? `La app de Shopify no tiene permisos suficientes. Faltan los scopes: ${missing.join(', ')}.`
            : 'La app de Shopify no tiene permisos suficientes para leer ubicaciones.';
          return res.status(400).json({
            ok: false,
            reason: 'shopify_scope_missing',
            errors: formattedLocationErrors,
            requestId: lastLocationRequestId,
            missing,
            message: friendlyMessage,
          });
        }
        try {
          logger.error('locations_query_graphql_errors', {
            requestId: lastLocationRequestId || null,
            errors: formattedLocationErrors,
          });
        } catch {}
        return res.status(502).json({
          ok: false,
          reason: 'shopify_graphql_errors',
          errors: formattedLocationErrors,
          requestId: lastLocationRequestId || null,
          message: 'Shopify devolvió errores al obtener las ubicaciones de la tienda.',
        });
      }

      if (!primaryLocation?.id) {
        return res.status(400).json({
          ok: false,
          reason: 'shopify_location_missing',
          requestId: lastLocationRequestId || null,
          ...(formattedLocationErrors.length ? { errors: formattedLocationErrors } : {}),
          message: 'No se encontró una ubicación activa en Shopify para asignar stock.',
        });
      }

      if (primaryLocation.isActive === false) {
        return res.status(400).json({
          ok: false,
          reason: 'shopify_location_inactive',
          requestId: lastLocationRequestId || null,
          message: 'La ubicación primaria encontrada no está activa en Shopify.',
        });
      }

      if (locationErrors.length) {
        const warningPayload = {
          code: 'shopify_locations_warning',
          message: 'Shopify devolvió advertencias al obtener las ubicaciones de la tienda.',
          requestId: lastLocationRequestId || null,
          detail: formattedLocationErrors,
        };
        warnings.push(warningPayload);
        try {
          logger.warn('locations_query_warning', warningPayload);
        } catch {}
      }

      primaryLocationId = primaryLocation.id;
      primaryLocationName = typeof primaryLocation.name === 'string' ? primaryLocation.name : '';

      try {
        logger.debug('primary_location_resolved', {
          locationId: primaryLocationId,
          name: primaryLocationName || null,
          isPrimary: primaryLocation?.isPrimary === true,
          requestId: lastLocationRequestId || null,
        });
      } catch {}
    } catch (err) {
      if (err?.message === 'SHOPIFY_ENV_MISSING') {
        throw err;
      }
      try {
        logger.error('locations_query_exception', {
          message: err?.message || String(err),
        });
      } catch {}
      return res.status(502).json({
        ok: false,
        reason: 'locations_query_failed',
        message: 'No se pudo obtener la ubicación principal de la tienda en Shopify.',
      });
    }

    const productMediaInput = stagedImage?.originalSource
      ? [{ mediaContentType: 'IMAGE', originalSource: stagedImage.originalSource, alt: imageAlt }]
      : [];

    const productInput = {
      title,
      status: 'ACTIVE',
      vendor: DEFAULT_VENDOR,
      templateSuffix: 'mousepads',
    };

    const {
      resp: productResp,
      json: productJson,
      requestId: productRequestId,
      attempts: productAttempts,
    } = await executeProductCreate({ input: productInput, filename });
    const productPayload = productJson?.data?.productCreate;
    if (!productResp.ok) {
      return res.status(502).json({
        ok: false,
        reason: 'shopify_error',
        status: productResp.status,
        body: productJson,
        requestId: productRequestId || null,
        ...(Array.isArray(productAttempts)
          ? { requestIds: productAttempts.map((entry) => entry?.requestId).filter(Boolean) }
          : {}),
        message: 'Shopify devolvió un error al crear el producto.',
      });
    }
    const productErrors = Array.isArray(productJson?.errors) ? productJson.errors : [];
    const formattedProductErrors = formatGraphQLErrors(productErrors);
    const hasProductPayload = productPayload && typeof productPayload === 'object' && productPayload.product;
    if (productErrors.length) {
      if (!hasProductPayload) {
        if (detectMissingScope(productErrors)) {
          const missingScopes = collectMissingScopes(productErrors);
          const missing = missingScopes.length ? missingScopes : ['write_products'];
          const friendlyMessage = missing.length
            ? `La app de Shopify no tiene permisos suficientes. Faltan los scopes: ${missing.join(', ')}.`
            : 'La app de Shopify no tiene permisos suficientes para crear productos.';
          return res.status(400).json({
            ok: false,
            reason: 'shopify_scope_missing',
            errors: formattedProductErrors,
            requestId: productRequestId || null,
            missing,
            message: friendlyMessage,
          });
        }
        const graphQLErrorMessages = collectGraphQLErrorMessages(productErrors);
        const graphQLErrorMessage = graphQLErrorMessages.length
          ? `Shopify devolvió errores: ${graphQLErrorMessages.join(' | ')}`
          : 'Shopify devolvió un error al crear el producto.';
        try {
          logger.error('product_create_graphql_errors', {
            requestId: productRequestId || null,
            messages: graphQLErrorMessages,
            errors: formattedProductErrors,
          });
        } catch {}
        return res.status(502).json({
          ok: false,
          reason: 'shopify_graphql_errors',
          errors: formattedProductErrors,
          requestId: productRequestId || null,
          message: graphQLErrorMessage,
          ...(graphQLErrorMessages.length ? { messages: graphQLErrorMessages } : {}),
        });
      }

      const errorMessages = collectGraphQLErrorMessages(productErrors);
      const warningMessage = errorMessages.length
        ? `Shopify devolvió advertencias: ${errorMessages.join(' | ')}`
        : 'Shopify devolvió advertencias durante la creación del producto.';
      const warningPayload = {
        code: 'shopify_graphql_warning',
        message: warningMessage,
        detail: formattedProductErrors,
        requestId: productRequestId || null,
        ...(errorMessages.length ? { messages: errorMessages } : {}),
      };
      warnings.push(warningPayload);
      try {
        logger.warn('product_create_graphql_warning', {
          requestId: productRequestId || null,
          messages: errorMessages,
          errors: formattedProductErrors,
        });
      } catch {}
    }
    if (!productPayload) {
      return res.status(502).json({
        ok: false,
        reason: 'product_create_failed',
        detail: productJson,
        requestId: productRequestId || null,
        message: 'Shopify devolvió un error al crear el producto.',
      });
    }
    const userErrors = sanitizeUserErrors(productPayload.userErrors);
    if (userErrors.length) {
      const userErrorMessages = userErrors
        .map((error) => (typeof error?.message === 'string' ? error.message.trim() : ''))
        .filter((msg) => Boolean(msg));
      const friendlyUserError = userErrorMessages.length
        ? userErrorMessages[0]
        : 'Shopify rechazó la creación del producto.';
      try {
        logger.error('product_create_user_errors', {
          requestId: productRequestId || null,
          userErrors: userErrors.map((error) => ({
            field: Array.isArray(error?.field) ? error.field.join('.') : undefined,
            message: typeof error?.message === 'string' ? error.message : '',
          })),
        });
      } catch {}
      return res.status(400).json({
        ok: false,
        reason: 'product_create_user_errors',
        message: friendlyUserError,
        detail: userErrors,
        requestId: productRequestId || null,
        ...(userErrorMessages.length ? { messages: userErrorMessages } : {}),
      });
    }
    const product = productPayload.product || {};
    let meta = buildProductMeta(product, {});
    let statusRequestId = null;
    let statusRequestIds = [];
    try {
      logger.debug('product_create_success', { requestId: productRequestId || null, productId: meta.productAdminId || null });
    } catch {}

    const productIdForVariants = typeof product?.id === 'string' && product.id
      ? product.id
      : meta.productAdminId;
    if (!productIdForVariants) {
      return res.status(502).json({
        ok: false,
        reason: 'product_missing_id',
        message: 'Shopify no devolvió un ID válido para el producto creado.',
        requestId: productRequestId || null,
        visibility,
        ...meta,
      });
    }


    const shouldSetPrivateTrue = mode === 'private' || isPrivateExplicit === true || isPrivate;
    const shouldSetPrivateFalse = mode !== 'private' && isPrivateExplicit === false;

    if (shouldSetPrivateTrue || shouldSetPrivateFalse) {
      const metafieldValue = shouldSetPrivateTrue ? 'true' : 'false';
      let metafieldRequestId = null;
      try {
        const metafieldsSetVariables = {
          metafields: [
            {
              ownerId: productIdForVariants,
              namespace: 'custom',
              key: 'private',
              type: 'boolean',
              value: metafieldValue,
            },
          ],
        };
        const metafieldResp = await shopifyAdminGraphQL(PRODUCT_METAFIELDS_SET_MUTATION, metafieldsSetVariables);
        metafieldRequestId = logRequestId('product_metafields_set_request', metafieldResp, {
          productId: productIdForVariants,
          value: metafieldValue,
        });
        const metafieldJson = await metafieldResp.json().catch(() => null);
        const metafieldErrors = Array.isArray(metafieldJson?.errors) ? metafieldJson.errors : [];
        const formattedMetafieldErrors = formatGraphQLErrors(metafieldErrors);
        const metafieldMessages = collectGraphQLErrorMessages(metafieldErrors);
        const metafieldPayload = metafieldJson?.data?.metafieldsSet;
        const rawMetafieldUserErrors = Array.isArray(metafieldPayload?.userErrors) ? metafieldPayload.userErrors : [];
        const metafieldUserErrors = sanitizeUserErrors(rawMetafieldUserErrors);
        const metafieldOk = metafieldResp.ok && metafieldPayload && !metafieldErrors.length && !metafieldUserErrors.length;

        if (!metafieldOk) {
          const warnPayload = {
            requestId: metafieldRequestId || null,
            productId: productIdForVariants,
            value: metafieldValue,
          };
          if (!metafieldResp.ok) {
            warnPayload.status = metafieldResp.status;
            if (metafieldJson != null) {
              warnPayload.body = metafieldJson;
            }
          }
          if (formattedMetafieldErrors.length) {
            warnPayload.errors = formattedMetafieldErrors;
          }
          if (metafieldMessages.length) {
            warnPayload.messages = metafieldMessages;
          }
          if (metafieldUserErrors.length) {
            warnPayload.userErrors = metafieldUserErrors;
          }
          if (metafieldResp.ok && !metafieldPayload) {
            warnPayload.detail = { reason: 'missing_payload' };
          }
          try {
            logger.warn('product_private_metafield_set_warning', warnPayload);
          } catch {}
        } else {
          try {
            logger.debug('product_private_metafield_set', {
              productId: productIdForVariants,
              value: metafieldValue,
              requestId: metafieldRequestId || null,
            });
          } catch {}
        }
      } catch (err) {
        try {
          logger.warn('product_private_metafield_set_exception', {
            productId: productIdForVariants,
            value: metafieldValue,
            requestId: metafieldRequestId || null,
            message: err?.message || String(err),
          });
        } catch {}
      }
    }

    const extractVariantNodes = (productData) => {
      if (!productData || typeof productData !== 'object') return [];
      const variants = productData.variants;
      if (Array.isArray(variants?.nodes)) {
        return variants.nodes.filter((node) => node && typeof node === 'object');
      }
      if (Array.isArray(variants?.edges)) {
        return variants.edges
          .map((edge) => edge?.node)
          .filter((node) => node && typeof node === 'object');
      }
      if (Array.isArray(variants)) {
        return variants.filter((node) => node && typeof node === 'object');
      }
      return [];
    };

    const initialVariants = extractVariantNodes(product);
    let defaultVariant = initialVariants.length ? initialVariants[0] : null;

    let variantQueryRequestId = null;
    let variantQueryRequestIds = [];
    if (!defaultVariant?.id || !defaultVariant?.inventoryItem?.id) {
      try {
        logger.debug('product_variant_default_query', {
          productId: productIdForVariants,
          hasVariant: Boolean(defaultVariant?.id),
        });
      } catch {}

      const {
        resp: variantQueryResp,
        json: variantQueryJson,
        requestId: variantQueryId,
        attempts: variantQueryAttempts,
      } = await executeProductVariantQuery({ productId: productIdForVariants, first: 1 });

      variantQueryRequestId = variantQueryId || null;
      variantQueryRequestIds = Array.isArray(variantQueryAttempts)
        ? variantQueryAttempts.map((entry) => entry?.requestId).filter(Boolean)
        : [];

      if (!variantQueryResp.ok) {
        return res.status(502).json({
          ok: false,
          reason: 'shopify_error',
          status: variantQueryResp.status,
          body: variantQueryJson,
          requestId: variantQueryRequestId,
          ...(variantQueryRequestIds.length ? { requestIds: variantQueryRequestIds } : {}),
          message: 'Shopify devolvió un error al obtener la variante por defecto del producto.',
          visibility,
          ...meta,
        });
      }

      const variantQueryErrors = Array.isArray(variantQueryJson?.errors) ? variantQueryJson.errors : [];
      const formattedVariantQueryErrors = formatGraphQLErrors(variantQueryErrors);
      const variantQueryProduct = variantQueryJson?.data?.product || null;

      if (variantQueryErrors.length && !variantQueryProduct) {
        if (detectMissingScope(variantQueryErrors)) {
          const missingScopes = collectMissingScopes(variantQueryErrors);
          const missing = missingScopes.length ? missingScopes : ['read_products'];
        const friendlyMessage = missing.length
          ? `La app de Shopify no tiene permisos suficientes. Faltan los scopes: ${missing.join(', ')}.`
          : 'La app de Shopify no tiene permisos suficientes para leer variantes.';
          return res.status(400).json({
            ok: false,
            reason: 'shopify_scope_missing',
            errors: formattedVariantQueryErrors,
            requestId: variantQueryRequestId || null,
            missing,
            message: friendlyMessage,
            visibility,
            ...meta,
          });
        }
        const variantQueryMessages = collectGraphQLErrorMessages(variantQueryErrors);
        const friendlyVariantQueryMessage = variantQueryMessages.length
          ? `Shopify devolvió errores: ${variantQueryMessages.join(' | ')}`
          : 'Shopify devolvió un error al obtener la variante del producto.';
        return res.status(502).json({
          ok: false,
          reason: 'shopify_graphql_errors',
          errors: formattedVariantQueryErrors,
          requestId: variantQueryRequestId || null,
          message: friendlyVariantQueryMessage,
          ...(variantQueryMessages.length ? { messages: variantQueryMessages } : {}),
          visibility,
          ...meta,
        });
      }

      const variantNodesFromQuery = extractVariantNodes(variantQueryProduct || {});
      if (variantNodesFromQuery.length) {
        defaultVariant = variantNodesFromQuery[0];
      }

      if (!defaultVariant?.id) {
        return res.status(502).json({
          ok: false,
          reason: 'product_missing_variant',
          message: 'Shopify no devolvió la variante por defecto del producto.',
          requestId: variantQueryRequestId || null,
          visibility,
          ...meta,
        });
      }

      if (variantQueryErrors.length) {
        const variantQueryMessages = collectGraphQLErrorMessages(variantQueryErrors);
        const warningMessage = variantQueryMessages.length
          ? `Shopify devolvió advertencias al leer la variante: ${variantQueryMessages.join(' | ')}`
          : 'Shopify devolvió advertencias al leer la variante del producto.';
        const warningPayload = {
          code: 'shopify_graphql_warning',
          message: warningMessage,
          detail: formattedVariantQueryErrors,
          requestId: variantQueryRequestId || null,
          ...(variantQueryRequestIds.length ? { requestIds: variantQueryRequestIds } : {}),
          ...(variantQueryMessages.length ? { messages: variantQueryMessages } : {}),
        };
        warnings.push(warningPayload);
        try {
          logger.warn('product_variant_query_warning', warningPayload);
        } catch {}
      }
    }

    if (!defaultVariant?.id) {
      return res.status(502).json({
        ok: false,
        reason: 'product_missing_variant',
        message: 'Shopify no devolvió variantes para el producto creado.',
        requestId: productRequestId || null,
        visibility,
        ...meta,
      });
    }

    const variantUpdateInput = { ...variantUpdateInputBase, id: defaultVariant.id };

    const {
      resp: variantResp,
      json: variantJson,
      requestId: variantGraphQLRequestIdRaw,
      attempts: variantAttempts,
    } = await executeProductVariantUpdate({ input: variantUpdateInput, productId: productIdForVariants });

    const variantGraphQLRequestId = variantGraphQLRequestIdRaw || null;
    const variantGraphQLRequestIds = Array.isArray(variantAttempts)
      ? variantAttempts.map((entry) => entry?.requestId).filter(Boolean)
      : [];

    const variantErrors = Array.isArray(variantJson?.errors) ? variantJson.errors : [];
    const formattedVariantErrors = formatGraphQLErrors(variantErrors);
    const variantPayload = variantJson?.data?.productVariantUpdate;
    const hasVariantPayload = variantPayload && typeof variantPayload === 'object';
    const rawVariantUserErrors = Array.isArray(variantPayload?.userErrors) ? variantPayload.userErrors : [];
    const variantUserErrors = sanitizeUserErrors(rawVariantUserErrors);
    const variantGraphQLNode = hasVariantPayload && typeof variantPayload?.productVariant === 'object'
      ? variantPayload.productVariant
      : null;
    const hasGraphQLMissingScope = detectMissingScope(variantErrors);
    const hasGraphQLUserMissingScope = detectMissingScope(rawVariantUserErrors);
    const variantRestIdCandidate = extractLegacyId(
      defaultVariant?.legacyResourceId
        ?? defaultVariant?.legacy_resource_id
        ?? meta?.variantId
        ?? defaultVariant?.id,
      'ProductVariant',
    );

    let variantUpdateSource = 'graphql';
    let variantRequestIdFinal = variantGraphQLRequestId;
    let variantRequestIdsFinal = variantGraphQLRequestIds;
    let updatedVariant = null;
    let restFallbackDetail = null;

    if (variantResp.ok && variantGraphQLNode && !variantUserErrors.length) {
      updatedVariant = variantGraphQLNode;
    } else if (!hasGraphQLMissingScope && !hasGraphQLUserMissingScope && variantRestIdCandidate) {
      try {
        const {
          resp: variantRestResp,
          json: variantRestJson,
          requestId: variantRestRequestId,
          attempts: variantRestAttempts,
        } = await executeProductVariantRestUpdate({
          variantId: variantRestIdCandidate,
          payload: variantUpdateInputBase,
        });

        const variantRestRequestIds = Array.isArray(variantRestAttempts)
          ? variantRestAttempts.map((entry) => entry?.requestId).filter(Boolean)
          : [];

        if (variantRestResp.ok && variantRestJson?.variant) {
          variantUpdateSource = 'rest';
          variantRequestIdFinal = variantRestRequestId || null;
          variantRequestIdsFinal = variantRestRequestIds;
          updatedVariant = buildVariantFromRestVariant(defaultVariant, variantRestJson.variant, variantUpdateInputBase);
          if (!variantResp.ok || variantErrors.length || variantUserErrors.length) {
            const variantGraphQLErrorMessages = collectGraphQLErrorMessages(variantErrors);
            if (variantErrors.length) {
              try {
                logger.warn('product_variant_update_graphql_errors', {
                  requestId: variantGraphQLRequestId || null,
                  messages: variantGraphQLErrorMessages,
                  errors: formattedVariantErrors,
                });
              } catch {}
            }
            const variantUserErrorMessages = variantUserErrors
              .map((error) => (typeof error?.message === 'string' ? error.message.trim() : ''))
              .filter(Boolean);
            const fallbackWarning = {
              code: 'product_variant_update_graphql_fallback',
              message: 'Shopify GraphQL fallA3 al actualizar la variante. Se utilizA3 REST como fallback.',
              requestId: variantGraphQLRequestId,
              ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
              detail: {
                status: typeof variantResp?.status === 'number' ? variantResp.status : undefined,
                errors: formattedVariantErrors.length ? formattedVariantErrors : undefined,
                errorMessages: variantGraphQLErrorMessages.length ? variantGraphQLErrorMessages : undefined,
                userErrors: variantUserErrors.length ? variantUserErrors : undefined,
                userErrorMessages: variantUserErrorMessages.length ? variantUserErrorMessages : undefined,
              },
            };
            warnings.push(fallbackWarning);
            try {
              logger.warn('product_variant_update_fallback', fallbackWarning);
            } catch {}
          }
        } else {
          restFallbackDetail = {
            status: typeof variantRestResp?.status === 'number' ? variantRestResp.status : undefined,
            body: variantRestJson,
            requestId: variantRestRequestId || null,
            ...(variantRestRequestIds.length ? { requestIds: variantRestRequestIds } : {}),
          };
        }
      } catch (err) {
        restFallbackDetail = { error: err?.message || String(err) };
      }
    }

    if (!updatedVariant) {
      if (!variantResp.ok) {
        return res.status(502).json({
          ok: false,
          reason: 'shopify_error',
          status: variantResp.status,
          body: variantJson,
          requestId: variantGraphQLRequestId,
          ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
          ...(restFallbackDetail ? { restFallback: restFallbackDetail } : {}),
          message: 'Shopify devolvió un error al actualizar la variante del producto.',
          visibility,
          ...meta,
        });
      }

      if (variantErrors.length && !hasVariantPayload) {
        if (hasGraphQLMissingScope) {
          const missingScopes = collectMissingScopes(variantErrors);
          const missing = missingScopes.length ? missingScopes : ['write_products'];
          const friendlyMessage = missing.length
            ? `La app de Shopify no tiene permisos suficientes. Faltan los scopes: ${missing.join(', ')}.`
            : 'La app de Shopify no tiene permisos suficientes para actualizar la variante.';
          return res.status(400).json({
            ok: false,
            reason: 'shopify_scope_missing',
            errors: formattedVariantErrors,
            requestId: variantGraphQLRequestId,
            ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
            ...(restFallbackDetail ? { restFallback: restFallbackDetail } : {}),
            missing,
            message: friendlyMessage,
            visibility,
            ...meta,
          });
        }
        const variantErrorMessages = collectGraphQLErrorMessages(variantErrors);
        const friendlyVariantMessage = variantErrorMessages.length
          ? `Shopify devolvió errores al actualizar la variante: ${variantErrorMessages.join(' | ')}`
          : 'Shopify devolvió un error al actualizar la variante del producto.';
        try {
          logger.error('product_variant_update_graphql_errors', {
            requestId: variantGraphQLRequestId || null,
            messages: variantErrorMessages,
            errors: formattedVariantErrors,
          });
        } catch {}
        return res.status(502).json({
          ok: false,
          reason: 'shopify_graphql_errors',
          errors: formattedVariantErrors,
          requestId: variantGraphQLRequestId,
          ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
          ...(variantErrorMessages.length ? { messages: variantErrorMessages } : {}),
          ...(restFallbackDetail ? { restFallback: restFallbackDetail } : {}),
          message: friendlyVariantMessage,
          visibility,
          ...meta,
        });
      }

      if (!hasVariantPayload) {
        return res.status(502).json({
          ok: false,
          reason: 'product_variant_update_failed',
          detail: variantJson,
          requestId: variantGraphQLRequestId,
          ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
          ...(restFallbackDetail ? { restFallback: restFallbackDetail } : {}),
          message: 'Shopify devolvió un error al actualizar la variante del producto.',
          visibility,
          ...meta,
        });
      }

      if (variantUserErrors.length) {
        const variantUserErrorMessages = variantUserErrors
          .map((error) => (typeof error?.message === 'string' ? error.message.trim() : ''))
          .filter((msg) => Boolean(msg));
        const friendlyVariantUserError = variantUserErrorMessages.length
          ? variantUserErrorMessages[0]
          : 'Shopify rechazó la actualización de la variante.';
        if (hasGraphQLUserMissingScope) {
          const missingScopes = collectMissingScopes(rawVariantUserErrors);
          const missing = missingScopes.length ? missingScopes : ['write_products'];
          return res.status(400).json({
            ok: false,
            reason: 'shopify_scope_missing',
            detail: variantUserErrors,
            requestId: variantGraphQLRequestId,
            ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
            ...(restFallbackDetail ? { restFallback: restFallbackDetail } : {}),
            missing,
            message: friendlyVariantUserError,
            visibility,
            ...meta,
            ...(variantUserErrorMessages.length ? { messages: variantUserErrorMessages } : {}),
          });
        }

        return res.status(400).json({
          ok: false,
          reason: 'product_variant_user_errors',
          detail: variantUserErrors,
          requestId: variantGraphQLRequestId,
          ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
          ...(restFallbackDetail ? { restFallback: restFallbackDetail } : {}),
          message: friendlyVariantUserError,
          visibility,
          ...meta,
          ...(variantUserErrorMessages.length ? { messages: variantUserErrorMessages } : {}),
        });
      }

      return res.status(502).json({
        ok: false,
        reason: 'product_variant_update_failed',
        detail: variantJson,
        requestId: variantGraphQLRequestId,
        ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
        ...(restFallbackDetail ? { restFallback: restFallbackDetail } : {}),
        message: 'Shopify devolvió un error al actualizar la variante del producto.',
        visibility,
        ...meta,
      });
    }

    if (variantUpdateSource === 'graphql' && variantErrors.length) {
      const variantWarningMessages = collectGraphQLErrorMessages(variantErrors);
      const variantWarningMessage = variantWarningMessages.length
        ? `Shopify devolvió advertencias al actualizar la variante: ${variantWarningMessages.join(' | ')}`
        : 'Shopify devolvió advertencias durante la actualización de la variante del producto.';
      const variantWarningPayload = {
        code: 'shopify_graphql_warning',
        message: variantWarningMessage,
        detail: formattedVariantErrors,
        requestId: variantGraphQLRequestId,
        ...(variantGraphQLRequestIds.length ? { requestIds: variantGraphQLRequestIds } : {}),
        ...(variantWarningMessages.length ? { messages: variantWarningMessages } : {}),
      };
      warnings.push(variantWarningPayload);
      try {
        logger.warn('product_variant_update_graphql_warning', variantWarningPayload);
      } catch {}
    }

    product.variants = { nodes: [updatedVariant] };
    meta = buildProductMeta(product, updatedVariant);

    try {
      const variantSuccessLog = {
        requestId: variantRequestIdFinal || null,
        productId: meta.productAdminId || null,
        variantId: meta.variantAdminId || null,
      };
      if (Array.isArray(variantRequestIdsFinal) && variantRequestIdsFinal.length) {
        variantSuccessLog.requestIds = variantRequestIdsFinal;
      }
      logger.debug('product_variant_update_success', variantSuccessLog);
    } catch {}

    variantInventoryMode = 'not_tracked';
    variantAvailableForSale = typeof updatedVariant?.availableForSale === 'boolean'
      ? updatedVariant.availableForSale
      : null;

    const variantInventoryItemId = typeof updatedVariant?.inventoryItem?.id === 'string'
      ? updatedVariant.inventoryItem.id
      : typeof defaultVariant?.inventoryItem?.id === 'string'
        ? defaultVariant.inventoryItem.id
        : null;

    if (!variantInventoryItemId) {
      return res.status(502).json({
        ok: false,
        reason: 'inventory_item_missing',
        message: 'Shopify no devolvió el inventoryItem de la variante para ajustar el stock.',
        requestId: variantRequestIdFinal || null,
        visibility,
        ...meta,
      });
    }

    const inventoryItemUpdateInput = {
      tracked: false,
    };

    let inventoryTrackWarning = null;

    try {
      const {
        resp: trackResp,
        json: trackJson,
        requestId: trackRequestId,
        attempts: trackAttempts,
      } = await executeInventoryItemUpdate({ id: variantInventoryItemId, input: inventoryItemUpdateInput });

      const trackRequestIds = Array.isArray(trackAttempts)
        ? trackAttempts.map((entry) => entry?.requestId).filter(Boolean)
        : [];

      const buildTrackWarning = (payload = {}) => ({
        code: 'inventory_tracking_warning',
        message: 'No se pudo desactivar el tracking de stock en Shopify. Continuamos permitiendo ventas sin stock.',
        requestId: trackRequestId || null,
        ...(trackRequestIds.length ? { requestIds: trackRequestIds } : {}),
        ...payload,
      });

      if (!trackResp.ok) {
        inventoryTrackWarning = buildTrackWarning({ status: trackResp.status, body: trackJson });
      } else {
        const trackErrors = Array.isArray(trackJson?.errors) ? trackJson.errors : [];
        const formattedTrackErrors = formatGraphQLErrors(trackErrors);
        const trackPayload = trackJson?.data?.inventoryItemUpdate;

        if (trackErrors.length && !trackPayload) {
          const missing = detectMissingScope(trackErrors)
            ? collectMissingScopes(trackErrors)
            : [];
          inventoryTrackWarning = buildTrackWarning({
            detail: formattedTrackErrors,
            ...(missing.length ? { missing } : {}),
          });
        } else if (!trackPayload) {
          inventoryTrackWarning = buildTrackWarning({ detail: trackJson });
        } else {
          const rawTrackUserErrors = Array.isArray(trackPayload?.userErrors) ? trackPayload.userErrors : [];
          const trackUserErrors = sanitizeUserErrors(rawTrackUserErrors);
          if (trackUserErrors.length) {
            const missing = detectMissingScope(rawTrackUserErrors)
              ? collectMissingScopes(rawTrackUserErrors)
              : [];
            inventoryTrackWarning = buildTrackWarning({
              detail: trackUserErrors,
              ...(missing.length ? { missing } : {}),
            });
          } else {
            try {
              logger.debug('inventory_item_update_success', {
                requestId: trackRequestId || null,
                productId: meta.productAdminId || null,
                variantId: meta.variantAdminId || null,
                inventoryItemId: variantInventoryItemId,
                tracked: false,
              });
            } catch {}
          }
        }
      }
    } catch (err) {
      if (err?.message === 'SHOPIFY_ENV_MISSING') {
        throw err;
      }
      inventoryTrackWarning = {
        code: 'inventory_tracking_warning',
        message: 'Ocurrió un error al desactivar el tracking de inventario. Continuamos permitiendo ventas sin stock.',
        detail: { message: err?.message || String(err) },
      };
    }

    if (inventoryTrackWarning) {
      variantInventoryMode = 'tracked_continue';
      warnings.push(inventoryTrackWarning);
      try {
        logger.warn('inventory_item_update_warning', {
          ...inventoryTrackWarning,
          productId: meta.productAdminId || null,
          variantId: meta.variantAdminId || null,
          inventoryItemId: variantInventoryItemId,
        });
      } catch {}
    }


    if (productMediaInput.length) {
      const mediaWarningMessage = 'No se pudo asociar la imagen, seguimos sin mockup.';

      let mediaAssociationOk = false;
      let mediaWarningPayload = null;

      try {
        const {
          resp: mediaResp,
          json: mediaJson,
          requestId: mediaRequestId,
          attempts: mediaAttempts,
        } = await executeProductCreateMedia({ productId: productIdForVariants, media: productMediaInput });

        const mediaRequestIds = Array.isArray(mediaAttempts)
          ? mediaAttempts.map((entry) => entry?.requestId).filter(Boolean)
          : [];
        const mediaErrors = Array.isArray(mediaJson?.errors) ? mediaJson.errors : [];
        const formattedMediaErrors = formatGraphQLErrors(mediaErrors);
        const mediaPayload = mediaJson?.data?.productCreateMedia;

        const buildWarning = (detail = null, extra = {}) => {
          const payload = {
            code: 'product_create_media_failed',
            message: mediaWarningMessage,
            requestId: mediaRequestId || null,
            ...(mediaRequestIds.length ? { requestIds: mediaRequestIds } : {}),
            ...(detail ? { detail } : {}),
          };
          if (Array.isArray(extra.missing) && extra.missing.length) {
            payload.missing = extra.missing;
          }
          return payload;
        };

        if (!mediaResp.ok) {
          mediaWarningPayload = buildWarning({
            status: mediaResp.status,
            body: mediaJson,
          });
        } else if (mediaErrors.length && !mediaPayload) {
          const missing = detectMissingScope(mediaErrors) ? collectMissingScopes(mediaErrors) : [];
          mediaWarningPayload = buildWarning({ errors: formattedMediaErrors }, { missing });
        } else if (!mediaPayload) {
          mediaWarningPayload = buildWarning({ body: mediaJson });
        } else {
          const rawMediaUserErrors = Array.isArray(mediaPayload?.mediaUserErrors) ? mediaPayload.mediaUserErrors : [];
          const mediaUserErrors = sanitizeUserErrors(rawMediaUserErrors);
          const createdMedia = Array.isArray(mediaPayload?.media) ? mediaPayload.media : [];
          const mediaWithErrors = createdMedia.filter((entry) => Array.isArray(entry?.mediaErrors) && entry.mediaErrors.length);
          const firstMedia = createdMedia.length ? createdMedia[0] : null;

          if (mediaErrors.length) {
            const missing = detectMissingScope(mediaErrors) ? collectMissingScopes(mediaErrors) : [];
            mediaWarningPayload = buildWarning({ errors: formattedMediaErrors }, { missing });
          } else if (mediaUserErrors.length) {
            const missing = detectMissingScope(rawMediaUserErrors) ? collectMissingScopes(rawMediaUserErrors) : [];
            mediaWarningPayload = buildWarning({ userErrors: mediaUserErrors }, { missing });
          } else if (mediaWithErrors.length) {
            mediaWarningPayload = buildWarning({ mediaErrors: mediaWithErrors.map((entry) => entry.mediaErrors) });
          } else if (!firstMedia) {
            mediaWarningPayload = buildWarning({ body: mediaJson });
          } else {
            mediaAssociationOk = true;
            try {
              logger.debug('product_create_media_success', {
                requestId: mediaRequestId || null,
                productId: productIdForVariants,
                mediaId: firstMedia?.id || null,
                status: firstMedia?.status || null,
              });
            } catch {}
          }
        }
      } catch (err) {
        try {
          logger.warn('product_create_media_exception', {
            message: err?.message || String(err),
            productId: productIdForVariants,
          });
        } catch {}

        mediaWarningPayload = {
          code: 'product_create_media_failed',
          message: mediaWarningMessage,
          detail: {
            message: err?.message || String(err),
          },
        };
      }

      if (!mediaAssociationOk && mediaWarningPayload) {
        warnings.push(mediaWarningPayload);
        try {
          logger.warn('product_create_media_warning', mediaWarningPayload);
        } catch {}
      }
    }

    if (!isActiveStatus(product)) {
      const {
        resp: statusResp,
        json: statusJson,
        requestId: statusUpdateRequestId,
        attempts: statusAttempts,
      } = await executeProductStatusUpdate({ productId: productIdForVariants, status: 'ACTIVE' });

      statusRequestId = statusUpdateRequestId || null;
      statusRequestIds = Array.isArray(statusAttempts)
        ? statusAttempts.map((entry) => entry?.requestId).filter(Boolean)
        : [];

      const statusErrors = Array.isArray(statusJson?.errors) ? statusJson.errors : [];
      const formattedStatusErrors = formatGraphQLErrors(statusErrors);
      const statusPayload = statusJson?.data?.productUpdate;

      if (!statusResp.ok) {
        return res.status(502).json({
          ok: false,
          reason: 'product_status_update_failed',
          status: statusResp.status,
          body: statusJson,
          requestId: statusRequestId,
          ...(statusRequestIds.length ? { requestIds: statusRequestIds } : {}),
          message: 'Shopify devolvió un error al activar el producto.',
          ...meta,
          visibility,
        });
      }

      if (statusErrors.length && !statusPayload) {
        if (detectMissingScope(statusErrors)) {
          const missingScopes = collectMissingScopes(statusErrors);
          const missing = missingScopes.length ? missingScopes : ['write_products'];
          const friendlyMessage = missing.length
            ? `La app de Shopify no tiene permisos suficientes. Faltan los scopes: ${missing.join(', ')}.`
            : 'La app de Shopify no tiene permisos suficientes para actualizar el producto.';
          return res.status(400).json({
            ok: false,
            reason: 'shopify_scope_missing',
            errors: formattedStatusErrors,
            requestId: statusRequestId,
            missing,
            message: friendlyMessage,
            ...meta,
            visibility,
          });
        }
        const statusErrorMessages = collectGraphQLErrorMessages(statusErrors);
        try {
          logger.error('product_status_update_graphql_errors', {
            requestId: statusRequestId,
            messages: statusErrorMessages,
            errors: formattedStatusErrors,
          });
        } catch {}
        return res.status(502).json({
          ok: false,
          reason: 'shopify_graphql_errors',
          errors: formattedStatusErrors,
          requestId: statusRequestId,
          message: statusErrorMessages.length
            ? `Shopify devolvió errores: ${statusErrorMessages.join(' | ')}`
            : 'Shopify devolvió un error al activar el producto.',
          ...(statusErrorMessages.length ? { messages: statusErrorMessages } : {}),
          ...meta,
          visibility,
        });
      }

      if (!statusPayload || typeof statusPayload !== 'object') {
        return res.status(502).json({
          ok: false,
          reason: 'product_status_update_invalid_response',
          detail: statusJson,
          requestId: statusRequestId,
          message: 'Shopify no devolvió un resultado válido al activar el producto.',
          ...meta,
          visibility,
        });
      }

      const statusUserErrors = sanitizeUserErrors(statusPayload.userErrors);
      if (statusUserErrors.length) {
        const statusUserErrorMessages = statusUserErrors
          .map((error) => (typeof error?.message === 'string' ? error.message.trim() : ''))
          .filter(Boolean);
        const friendlyStatusMessage = statusUserErrorMessages.length
          ? statusUserErrorMessages[0]
          : 'Shopify rechazó el cambio de estado del producto.';
        try {
          logger.error('product_status_update_user_errors', {
            requestId: statusRequestId,
            userErrors: statusUserErrors.map((error) => ({
              field: Array.isArray(error?.field) ? error.field.join('.') : undefined,
              message: typeof error?.message === 'string' ? error.message : '',
            })),
          });
        } catch {}
        return res.status(400).json({
          ok: false,
          reason: 'product_status_update_user_errors',
          message: friendlyStatusMessage,
          detail: statusUserErrors,
          requestId: statusRequestId,
          ...(statusUserErrorMessages.length ? { messages: statusUserErrorMessages } : {}),
          ...meta,
          visibility,
        });
      }

      if (statusErrors.length) {
        const statusErrorMessages = collectGraphQLErrorMessages(statusErrors);
        const warningMessage = statusErrorMessages.length
          ? `Shopify devolvió advertencias al activar el producto: ${statusErrorMessages.join(' | ')}`
          : 'Shopify devolvió advertencias al activar el producto.';
        const warningPayload = {
          code: 'product_status_update_warning',
          message: warningMessage,
          detail: formattedStatusErrors,
          requestId: statusRequestId,
          ...(statusErrorMessages.length ? { messages: statusErrorMessages } : {}),
        };
        warnings.push(warningPayload);
        try {
          logger.warn('product_status_update_graphql_warning', {
            requestId: statusRequestId,
            messages: statusErrorMessages,
            errors: formattedStatusErrors,
          });
        } catch {}
      }

      const updatedProduct = statusPayload.product && typeof statusPayload.product === 'object'
        ? statusPayload.product
        : null;

      if (updatedProduct) {
        product = { ...product, ...updatedProduct };
      } else {
        product = { ...product, status: 'ACTIVE' };
      }

      meta = buildProductMeta(product, {});

      try {
        logger.debug('product_status_update_success', {
          requestId: statusRequestId,
          productId: meta.productAdminId || meta.productId || null,
        });
      } catch {}
    }

    if (!isActiveStatus(product)) {
      return res.status(400).json({
        ok: false,
        reason: 'product_not_active',
        message: 'El producto creado no quedó activo en Shopify. Revisá la visibilidad configurada y volvé a intentarlo.',
        ...meta,
        visibility,
        requestId: statusRequestId,
        ...(statusRequestIds.length ? { requestIds: statusRequestIds } : {}),
      });
    }

    if (!hasVariant(product)) {
      return res.status(400).json({
        ok: false,
        reason: 'product_missing_variant',
        message: 'Shopify no devolvió variantes para el producto creado.',
        ...meta,
        visibility,
      });
    }

    let publicationInfo = null;
    let publishResult = null;

    try {
      publicationInfo = await resolveOnlineStorePublicationId({ preferEnv: true });
      if (publicationInfo?.id) {
        try {
          logger.debug('publish_product_publication_resolved', {
            id: publicationInfo.id,
            source: publicationInfo.source || 'unknown',
            name: publicationInfo.name || null,
          });
        } catch {}
      }
    } catch (err) {
      if (err?.message === 'online_store_publication_empty') {
        logPublicationAbort(meta, 'no_publications');
        return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_empty', ONLINE_STORE_DISABLED_MESSAGE, {
          allowSkipPublication: true,
          missing: ['online_store_channel'],
        });
      }
      if (err?.message === 'online_store_publication_missing') {
        logPublicationAbort(meta, 'missing_scope');
        return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_missing', ONLINE_STORE_MISSING_MESSAGE, {
          missing: ['write_publications'],
        });
      }
      if (err?.message === 'online_store_publication_query_failed') {
        logPublicationAbort(meta, 'publication_query_failed', { errors: err?.errors || null });
        return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_missing', ONLINE_STORE_MISSING_MESSAGE, {
          missing: ['read_publications', 'write_publications'],
          errors: err?.errors || null,
        });
      }
      throw err;
    }

    publishResult = await publishToOnlineStore(meta.productAdminId, publicationInfo?.id, {
      maxAttempts: 5,
      initialDelayMs: 200,
      maxDelayMs: 3200,
      preferEnv: publicationInfo?.source === 'env' || publicationInfo?.source === 'override',
    });

    if (!publishResult?.ok) {
      const requestIds = Array.isArray(publishResult?.requestIds) ? publishResult.requestIds : [];
      if (publishResult.reason === 'publication_missing') {
        logPublicationAbort(meta, 'still_missing_after_retries', { requestIds });
        return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_missing', ONLINE_STORE_MISSING_MESSAGE, {
          publicationId: publicationInfo?.id || null,
          publicationSource: publicationInfo?.source || null,
          requestIds,
          missing: ['write_publications'],
        });
      }
      if (publishResult.reason === 'graphql_errors' || publishResult.reason === 'user_errors') {
        const combined = publishResult.errors || publishResult.userErrors || [];
        if (detectMissingScope(combined)) {
          logPublicationAbort(meta, 'missing_scope', { requestIds });
          return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_missing', ONLINE_STORE_MISSING_MESSAGE, {
            publicationId: publicationInfo?.id || null,
            publicationSource: publicationInfo?.source || null,
            requestIds,
            missing: ['write_publications'],
          });
        }
      }

      logPublicationAbort(meta, publishResult.reason || 'publish_failed', { requestIds });
      return res.status(502).json({
        ok: false,
        reason: publishResult.reason || 'publish_failed',
        message: 'Shopify rechazó la publicación del producto.',
        detail: publishResult,
        ...meta,
        visibility,
        publishAttempts: typeof publishResult.attempt === 'number' ? publishResult.attempt : undefined,
      });
    }

    let pdfAsset = null;
    try {
      const rawPrintDataUrl = typeof body.printDataUrl === 'string' ? body.printDataUrl.trim() : '';
      const rawPrintSourceUrl = typeof body.printSourceUrl === 'string' ? body.printSourceUrl.trim() : '';
      if (rawPrintDataUrl || rawPrintSourceUrl) {
        let printBuffer = null;
        if (rawPrintDataUrl && rawPrintDataUrl.startsWith('data:')) {
          const match = /^data:([^;,]+);base64,(.+)$/i.exec(rawPrintDataUrl);
          if (!match) {
            throw new Error('invalid_print_dataurl');
          }
          printBuffer = Buffer.from(match[2], 'base64');
        } else if (rawPrintSourceUrl) {
          const response = await fetch(rawPrintSourceUrl);
          if (!response.ok) {
            const err = new Error('print_source_download_failed');
            err.status = response.status;
            throw err;
          }
          const arrayBuffer = await response.arrayBuffer();
          printBuffer = Buffer.from(arrayBuffer);
        }
        if (!printBuffer || !printBuffer.length) {
          throw new Error('print_buffer_empty');
        }
        const approxDensity = typeof approxDpi === 'number' && Number.isFinite(approxDpi) ? approxDpi : null;
        const requestedDensity = Number(body.printDpi);
        const density = Number.isFinite(requestedDensity) && requestedDensity > 0
          ? requestedDensity
          : (approxDensity && approxDensity > 0 ? approxDensity : 300);
        const backgroundCandidate = typeof body.printBackgroundColor === 'string'
          ? body.printBackgroundColor.trim()
          : '';
        const background = backgroundCandidate || '#ffffff';
        const widthValue = typeof widthCm === 'number' && Number.isFinite(widthCm) ? widthCm : null;
        const heightValue = typeof heightCm === 'number' && Number.isFinite(heightCm) ? heightCm : null;
        const EXTRA_MARGIN_TOTAL_CM = 2;
        const marginPerSideCm = EXTRA_MARGIN_TOTAL_CM / 2;
        const finalWidthCm = widthValue != null ? widthValue + EXTRA_MARGIN_TOTAL_CM : null; // used for metadata/pdf dimensions
        const finalHeightCm = heightValue != null ? heightValue + EXTRA_MARGIN_TOTAL_CM : null;
        const pdfResult = await imageBufferToPdf({
          buffer: printBuffer,
          density,
          background,
          widthCm: widthValue || undefined,
          heightCm: heightValue || undefined,
          bleedCm: marginPerSideCm,
        });
        const previewBuffer = await sharp(printBuffer)
          .resize({ width: 600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 70, chromaSubsampling: '4:2:0' })
          .toBuffer();
        const pdfSlug = slugifyName(designNameForPdf) || 'diseno';
        const pdfMetadata = {
          slug: pdfSlug,
          designName: designNameForPdf,
          widthCm: widthValue ?? undefined,
          heightCm: heightValue ?? undefined,
          widthCmPrint: finalWidthCm ?? undefined,
          heightCmPrint: finalHeightCm ?? undefined,
          material: materialLabel || materialRaw || null,
          createdBy: 'publish-product',
          backgroundColor: background,
        };
        if (typeof body.jobId === 'string' && body.jobId.trim()) {
          pdfMetadata.jobId = body.jobId.trim();
        }
        let pdfUpload;
        try {
          pdfUpload = await savePrintPdfToSupabase(
            pdfResult.pdfBuffer,
            `${pdfSlug}.pdf`,
            pdfMetadata,
          );
        } catch (uploadErr) {
          if (uploadErr?.code === 'supabase_object_too_large') {
            throw Object.assign(new Error('pdf_too_large'), {
              code: 'pdf_too_large',
              size: uploadErr.size,
              limit: uploadErr.limit,
            });
          }
          throw uploadErr;
        }
        let previewUpload = null;
        try {
          previewUpload = await savePrintPreviewToSupabase(
            previewBuffer,
            `${pdfSlug}.jpg`,
            {
              jobId: pdfMetadata.jobId ?? pdfMetadata.job_id,
              jobKey: pdfMetadata.jobKey,
              slug: pdfSlug,
              widthCm: widthValue ?? undefined,
              heightCm: heightValue ?? undefined,
              material: materialLabel || materialRaw || null,
              createdBy: 'publish-product',
            },
          );
        } catch (previewErr) {
          logger.warn('publish-product preview_store_warning', previewErr);
        }
        const previewPath = previewUpload?.path
          ? (previewUpload.path.startsWith('outputs/') ? previewUpload.path : `outputs/${previewUpload.path}`)
          : (pdfUpload.path.startsWith('outputs/') ? pdfUpload.path : `outputs/${pdfUpload.path}`);
        pdfAsset = {
          ...pdfUpload,
          previewPath,
        };

        try {
          const supabase = getSupabaseAdmin();
          const normalizedBg = normalizeBackgroundHex(background);
          const imageHash = computeImageHash(printBuffer);
          const jobKey = buildPrintsJobKey({
            slug: pdfSlug,
            widthCm: finalWidthCm ?? widthValue,
            heightCm: finalHeightCm ?? heightValue,
            material: materialLabel || materialRaw || null,
            backgroundColor: normalizedBg,
            imageHash,
          });
          const jobIdForRecord = typeof body.jobId === 'string' ? body.jobId.trim() : null;
          const { error: printsErr } = await supabase.from('prints').upsert({
            job_key: jobKey,
            bucket: OUTPUT_BUCKET,
            file_path: pdfUpload.path,
            file_name: pdfUpload.fileName || pdfUpload.path.split('/').pop(),
            slug: pdfSlug,
            width_cm: finalWidthCm ?? widthValue ?? null,
            height_cm: finalHeightCm ?? heightValue ?? null,
            material: materialLabel || materialRaw || null,
            bg_color: normalizedBg,
            job_id: jobIdForRecord || null,
            file_size_bytes: pdfResult.pdfBuffer.length,
            image_hash: imageHash,
          }, { onConflict: 'job_key', ignoreDuplicates: false });
          if (printsErr) {
            throw printsErr;
          }
        } catch (printsErr) {
          logger.error('publish-product prints_upsert', { error: printsErr?.message || printsErr });
        }
      }
    } catch (pdfError) {
      logger.error('publish-product pdf_generation_failed', pdfError);
      if (pdfError?.code === 'pdf_too_large') {
        return res.status(413).json({
          ok: false,
          reason: 'pdf_too_large',
          message: 'El PDF generado supera el tamao permitido por Supabase.',
          limit_bytes: pdfError.limit ?? undefined,
          size_bytes: pdfError.size ?? undefined,
        });
      }
      return res.status(500).json({
        ok: false,
        reason: 'pdf_generation_failed',
        message: 'No se pudo generar el PDF de impresion.',
      });
    }

    const warningMessages = warnings
      .map((entry) => (entry && typeof entry.message === 'string' ? entry.message : typeof entry === 'string' ? entry : ''))
      .filter((entry) => entry);
    const warningCodes = warnings
      .map((entry) => (entry && typeof entry.code === 'string' ? entry.code : ''))
      .filter((entry) => entry);

    const responsePayload = {
      ok: true,
      ...meta,
      status: product?.status,
      visibility,
      ...(warnings.length ? { warnings } : {}),
      ...(warningMessages.length ? { warningMessages } : {}),
      ...(warningCodes.length ? { warningCodes } : {}),
    };

    if (pdfAsset) {
      const downloadUrl = pdfAsset.publicUrl || pdfAsset.signedUrl || null;
      const previewUrl = `/api/prints/preview?path=${encodeURIComponent(pdfAsset.previewPath)}`;
      responsePayload.assets = {
        ...(responsePayload.assets || {}),
        pdf_path: pdfAsset.path,
        pdf_url: downloadUrl,
        pdf_expires_in: pdfAsset.expiresIn,
        preview_url: previewUrl,
      };
      responsePayload.pdf = {
        path: pdfAsset.path,
        downloadUrl,
        expiresIn: pdfAsset.expiresIn,
        previewUrl,
      };
    }

    responsePayload.publicationId = publishResult?.publicationId || null;
    responsePayload.publicationSource = publicationInfo?.source || null;
    responsePayload.requestIds = publishResult?.requestIds || null;
    if (typeof publishResult?.attempt === 'number') {
      responsePayload.publishAttempts = publishResult.attempt;
    }

    return res.status(200).json(responsePayload);
  } catch (e) {
    if (e?.message === 'SHOPIFY_ENV_MISSING') {
      const missing = Array.isArray(e?.missing) && e.missing.length
        ? e.missing
        : ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN'];
      return res.status(400).json({
        ok: false,
        reason: 'shopify_env_missing',
        missing,
        message: `Faltan variables de entorno para Shopify: ${missing.join(', ')}.`,
      });
    }
    logger.error('publish_product_error', e);
    return res.status(500).json({ ok: false, reason: 'internal_error' });
  }
}

export default publishProduct;







