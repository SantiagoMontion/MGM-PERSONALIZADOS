import { apiFetch } from './api';
import { FlowState } from '@/state/flow';

const DEFAULT_STORE_BASE = 'https://kw0f4u-ji.myshopify.com';
const IS_DEV = Boolean(
  typeof import.meta !== 'undefined'
    && (import.meta as { env?: { DEV?: boolean } }).env
    && (import.meta as { env?: { DEV?: boolean } }).env?.DEV,
);
const DEFAULT_STOREFRONT_API_VERSION = '2024-07';

const PRODUCT_LABELS = {
  mousepad: 'Mousepad',
  glasspad: 'Glasspad',
} as const;

export const ONLINE_STORE_MISSING_MESSAGE = [
  'No pudimos encontrar el canal Online Store para publicar este producto.',
  'Revisá: 1) que el canal esté instalado, 2) que la app tenga el scope write_publications.',
  'Luego probá de nuevo.',
].join('\n');

export const ONLINE_STORE_DISABLED_MESSAGE = 'Tu tienda no tiene el canal Online Store habilitado. Instalalo o bien omití la publicación y usa Storefront para el carrito.';

function slugify(value: string, fallback = 'mockup') {
  const base = (value || '').toString();
  const cleaned = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return (cleaned || fallback).slice(0, 60);
}

function safeNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function formatDimension(value?: number | null): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1).replace(/\.0+$/, '');
}

function formatMeasurement(width?: number | null, height?: number | null): string | undefined {
  const w = formatDimension(width);
  const h = formatDimension(height);
  if (!w || !h) return undefined;
  return `${w}x${h}`;
}

function readJobId(flow: FlowState): string {
  const candidates = [
    (flow as any)?.jobId,
    (flow as any)?.job_id,
    (flow as any)?.editorState?.job_id,
    (flow as any)?.editorState?.jobId,
    (flow as any)?.editorState?.job?.job_id,
    (flow as any)?.editorState?.job?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

type PrivateDraftOrderMetadata = {
  note?: string;
  attributes: { name: string; value: string }[];
};

function buildPrivateDraftOrderMetadata(options: {
  flow: FlowState;
  measurement?: string;
  productLabel: string;
  materialLabel?: string;
  customerEmail?: string;
}): PrivateDraftOrderMetadata {
  const { flow, measurement, productLabel, materialLabel, customerEmail } = options;
  const lines: string[] = [];
  const attributes: { name: string; value: string }[] = [];
  const pushAttribute = (name: string, value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    attributes.push({ name, value: trimmed.slice(0, 255) });
  };

  const jobId = readJobId(flow);
  if (jobId) {
    lines.push(`Job ID: ${jobId}`);
    pushAttribute('job_id', jobId);
  }

  const designName = typeof flow.designName === 'string' ? flow.designName.trim() : '';
  if (designName) {
    lines.push(`Diseño: ${designName}`);
    pushAttribute('design_name', designName);
  }

  if (productLabel) {
    lines.push(`Producto: ${productLabel}`);
    pushAttribute('product_label', productLabel);
  }

  if (materialLabel) {
    lines.push(`Material: ${materialLabel}`);
    pushAttribute('material', materialLabel);
  }

  if (measurement) {
    lines.push(`Medida: ${measurement} cm`);
    pushAttribute('measurement_cm', `${measurement} cm`);
  }

  if (customerEmail) {
    lines.push(`Email cliente: ${customerEmail}`);
    pushAttribute('customer_email', customerEmail);
  }

  const sourceLine = 'Origen: Editor personalizado';
  lines.push(sourceLine);
  pushAttribute('mgm_source', 'editor');

  const note = lines.join('\n').slice(0, 1024);

  return { note, attributes };
}

function buildGlasspadTitle(designName?: string, measurement?: string): string {
  const sections = ['Glasspad'];
  const normalizedName = (designName || '').trim();
  if (normalizedName) sections.push(normalizedName);
  const normalizedMeasurement = (measurement || '').trim();
  if (normalizedMeasurement) sections.push(normalizedMeasurement);
  return `${sections.join(' ')} | PERSONALIZADO`;
}

function buildDefaultTitle(
  productLabel: string,
  designName?: string,
  measurement?: string,
  material?: string,
): string {
  const parts = [productLabel];
  if (designName) parts.push(designName);
  if (measurement) parts.push(measurement);
  if (material) parts.push(material);
  return `${parts.join(' ')} | PERSONALIZADO`;
}

function buildMetaDescription(
  productLabel: string,
  designName: string,
  measurement?: string,
  material?: string,
): string {
  const parts: string[] = [`${productLabel} gamer personalizado`];
  if (designName) parts.push(`Diseño ${designName}`);
  if (measurement) parts.push(`Medida ${measurement} cm`);
  if (material) parts.push(`Material ${material}`);
  return `${parts.join('. ')}.`;
}

export async function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onloadend = () => res(typeof r.result === 'string' ? r.result : '');
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

function sanitizeWarningMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((msg): msg is string => Boolean(msg));
}

function deriveWarningMessagesFromWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry;
      if (typeof (entry as { message?: unknown }).message === 'string') {
        return String((entry as { message: string }).message);
      }
      return '';
    })
    .map((msg) => (typeof msg === 'string' ? msg.trim() : ''))
    .filter((msg): msg is string => Boolean(msg));
}

export interface CreateJobOptions {
  reuseLastProduct?: boolean;
  skipPublication?: boolean;
  onPrivateStageChange?: (stage: 'creating_product' | 'creating_checkout') => void;
  discountCode?: string;
}

export async function createJobAndProduct(
  mode: 'checkout' | 'cart' | 'private',
  flow: FlowState,
  options: CreateJobOptions = {},
) {
  const {
    reuseLastProduct = false,
    skipPublication = false,
    onPrivateStageChange,
    discountCode,
  } = options;
  const lastProduct = flow.lastProduct;
  const isPrivate = mode === 'private';
  const requestedVisibility: 'public' | 'private' = isPrivate ? 'private' : 'public';
  const normalizedDiscountCode = typeof discountCode === 'string' ? discountCode.trim() : '';
  const canReuse = reuseLastProduct
    && lastProduct?.productId
    && lastProduct?.variantId
    && lastProduct.visibility === requestedVisibility;

  const customerEmail = typeof flow.customerEmail === 'string' ? flow.customerEmail.trim() : '';

  let publish: any = null;
  let productId: string | undefined;
  let variantId: string | undefined;
  let productHandle: string | undefined;
  let productUrl: string | undefined;
  let visibilityResult: 'public' | 'private' = requestedVisibility;
  let collectedWarnings: any[] | undefined;
  let collectedWarningMessages: string[] | undefined;

  let mockupDataUrl = '';
  let productType: 'glasspad' | 'mousepad' = flow.productType === 'glasspad' ? 'glasspad' : 'mousepad';
  let productLabel = PRODUCT_LABELS[productType];
  let designName = (flow.designName || '').trim();
  let materialLabel = (flow.material || '').trim() || (productType === 'glasspad' ? 'Glasspad' : '');
  let widthCm = safeNumber((flow.editorState as any)?.size_cm?.w);
  let heightCm = safeNumber((flow.editorState as any)?.size_cm?.h);
  let approxDpi = safeNumber(flow.approxDpi);
  let priceTransferRaw = safeNumber(flow.priceTransfer);
  const priceCurrencyRaw = typeof flow.priceCurrency === 'string' ? flow.priceCurrency : 'ARS';
  let priceCurrency = priceCurrencyRaw.trim() || 'ARS';
  let measurementLabel = formatMeasurement(widthCm, heightCm);
  let productTitle = productType === 'glasspad'
    ? buildGlasspadTitle(designName, measurementLabel)
    : buildDefaultTitle(productLabel, designName, measurementLabel, materialLabel);
  let metaDescription = buildMetaDescription(productLabel, designName, measurementLabel, materialLabel);

  const privateDraftOrder = isPrivate
    ? buildPrivateDraftOrderMetadata({
      flow,
      measurement: measurementLabel,
      productLabel,
      materialLabel,
      customerEmail,
    })
    : null;

  const extraTags: string[] = [`currency-${priceCurrency.toLowerCase()}`];
  if (materialLabel) {
    const materialTag = materialLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (materialTag) extraTags.push(`material-${materialTag}`);
  }
  if (flow.lowQualityAck) extraTags.push('calidad-baja');
  if (isPrivate) extraTags.push('private');
  let filename = `${slugify(designName || productTitle)}.png`;
  let imageAlt = `Mockup ${productTitle}`;

  if (!canReuse) {
    if (!flow.mockupBlob) throw new Error('missing_mockup');
    mockupDataUrl = await blobToBase64(flow.mockupBlob);

    if (isPrivate) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(customerEmail)) {
        const err: Error & { reason?: string } = new Error('missing_customer_email');
        err.reason = 'missing_customer_email';
        throw err;
      }
    }

    if (isPrivate) {
      try {
        onPrivateStageChange?.('creating_product');
      } catch (stageErr) {
        console.debug?.('[createJobAndProduct] stage_callback_failed', stageErr);
      }
    }

    const publishResp = await apiFetch('/api/publish-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productType,
        mockupDataUrl,
        designName,
        title: productTitle,
        material: materialLabel,
        widthCm,
        heightCm,
        approxDpi,
        priceTransfer: priceTransferRaw,
        priceCurrency,
        lowQualityAck: Boolean(flow.lowQualityAck),
        imageAlt,
        filename,
        tags: extraTags,
        description: '',
        seoDescription: metaDescription,
        visibility: requestedVisibility,
        isPrivate,
      }),
    });
    const publishData = await publishResp.json().catch(() => null);
    publish = publishData;
    if (Array.isArray(publishData?.warnings) && publishData.warnings.length) {
      collectedWarnings = publishData.warnings;
    }
    const initialWarningMessages = sanitizeWarningMessages(publishData?.warningMessages);
    if (initialWarningMessages.length) {
      collectedWarningMessages = initialWarningMessages;
    }
    if (!publishResp.ok || !publish?.ok) {
      const reason = publish?.reason || publish?.error || `publish_failed_${publishResp.status}`;
      const err: Error & { reason?: string; friendlyMessage?: string; missing?: string[] } = new Error(reason);
      err.reason = reason;
      if (typeof publish?.message === 'string' && publish.message.trim()) {
        err.friendlyMessage = publish.message.trim();
      }
      if (Array.isArray(publish?.missing) && publish.missing.length) {
        err.missing = publish.missing;
      }
      if (publish?.productId) productId = String(publish.productId);
      if (publish?.variantId) variantId = String(publish.variantId);
      if (typeof publish?.productHandle === 'string') productHandle = publish.productHandle;
      if (typeof publish?.productUrl === 'string') productUrl = publish.productUrl;
      if (publish?.visibility === 'private') visibilityResult = 'private';
      throw err;
    }
  } else {
    const reuseWarnings = Array.isArray(lastProduct?.warnings) && lastProduct.warnings?.length
      ? lastProduct.warnings
      : undefined;
    const reuseWarningMessages = sanitizeWarningMessages(lastProduct?.warningMessages);
    publish = {
      ok: true,
      productId: lastProduct?.productId,
      variantId: lastProduct?.variantId,
      productHandle: lastProduct?.productHandle,
      productUrl: lastProduct?.productUrl,
      visibility: lastProduct?.visibility,
      ...(reuseWarnings ? { warnings: reuseWarnings } : {}),
      ...(reuseWarningMessages.length ? { warningMessages: reuseWarningMessages } : {}),
    };
    productId = lastProduct?.productId;
    variantId = lastProduct?.variantId;
    productHandle = lastProduct?.productHandle;
    productUrl = lastProduct?.productUrl;
    visibilityResult = lastProduct?.visibility || requestedVisibility;
    collectedWarnings = reuseWarnings;
    collectedWarningMessages = reuseWarningMessages.length ? reuseWarningMessages : undefined;

    if (!variantId) {
      const err = new Error('missing_variant');
      (err as Error & { reason?: string }).reason = 'missing_variant';
      throw err;
    }

    if (!skipPublication && productId && !isPrivate) {
      try {
        await ensureProductPublication(productId);
      } catch (error: any) {
        const detail = error?.response;
        const rawReason = typeof detail?.error === 'string'
          ? detail.error
          : typeof error?.reason === 'string'
            ? error.reason
            : typeof error?.message === 'string'
              ? error.message
              : 'ensure_publication_failed';
        const normalizedReason = rawReason === 'publication_missing'
          ? 'online_store_publication_missing'
          : rawReason;
        const err: Error & { reason?: string; friendlyMessage?: string } = new Error(normalizedReason);
        err.reason = normalizedReason;
        if (normalizedReason === 'online_store_publication_missing') {
          err.friendlyMessage = ONLINE_STORE_MISSING_MESSAGE;
        }
        throw err;
      }
    }
  }

  if (!publish || typeof publish !== 'object') {
    const err = new Error('publish_failed');
    (err as Error & { reason?: string }).reason = 'publish_failed';
    throw err;
  }

  if (!collectedWarnings && Array.isArray(publish.warnings) && publish.warnings.length) {
    collectedWarnings = publish.warnings;
  }
  if (!collectedWarningMessages) {
    const publishWarningMessages = sanitizeWarningMessages(publish.warningMessages);
    if (publishWarningMessages.length) {
      collectedWarningMessages = publishWarningMessages;
    }
  }
  if (!collectedWarningMessages && collectedWarnings && collectedWarnings.length) {
    const derivedMessages = deriveWarningMessagesFromWarnings(collectedWarnings);
    if (derivedMessages.length) {
      collectedWarningMessages = derivedMessages;
    }
  }

  if (collectedWarningMessages && collectedWarningMessages.length) {
    try {
      console.warn('[createJobAndProduct] warnings', collectedWarningMessages);
    } catch (warnErr) {
      console.debug?.('[createJobAndProduct] warn_log_failed', warnErr);
    }
  }

  productId = publish.productId ? String(publish.productId) : productId;
  variantId = publish.variantId ? String(publish.variantId) : variantId;
  productHandle = typeof publish.productHandle === 'string' ? publish.productHandle : productHandle;
  productUrl = typeof publish.productUrl === 'string'
    ? publish.productUrl
    : productUrl || (productHandle ? `${DEFAULT_STORE_BASE}/products/${productHandle}` : undefined);
  visibilityResult = publish?.visibility === 'private' ? 'private' : visibilityResult;

  if (!variantId) {
    const warningsPayload = collectedWarnings && collectedWarnings.length ? collectedWarnings : undefined;
    const warningMessagesPayload = collectedWarningMessages && collectedWarningMessages.length
      ? collectedWarningMessages
      : undefined;
    flow.set({
      lastProduct: {
        productId,
        productUrl,
        productHandle,
        visibility: visibilityResult,
        ...(warningsPayload ? { warnings: warningsPayload } : {}),
        ...(warningMessagesPayload ? { warningMessages: warningMessagesPayload } : {}),
      },
    });
    throw new Error('missing_variant');
  }

  const result: {
    checkoutUrl?: string;
    cartUrl?: string;
    cartPlain?: string;
    cartId?: string;
    cartToken?: string;
    productId?: string;
    variantId?: string;
    productUrl?: string;
    visibility: 'public' | 'private';
    draftOrderId?: string;
    draftOrderName?: string;
    warnings?: any[];
    warningMessages?: string[];
  } = {
    productId,
    variantId,
    productUrl,
    visibility: visibilityResult,
    ...(collectedWarnings && collectedWarnings.length ? { warnings: collectedWarnings } : {}),
    ...(collectedWarningMessages && collectedWarningMessages.length
      ? { warningMessages: collectedWarningMessages }
      : {}),
  };

  try {
    if (mode === 'checkout' || isPrivate) {
      if (isPrivate) {
        try {
          onPrivateStageChange?.('creating_checkout');
        } catch (stageErr) {
          console.debug?.('[createJobAndProduct] stage_callback_failed', stageErr);
        }
      }
      if (isPrivate) {
        const privatePayload: Record<string, unknown> = {
          variantId,
          quantity: 1,
          ...(customerEmail ? { email: customerEmail } : {}),
        };
        if (privateDraftOrder?.note) {
          privatePayload.note = privateDraftOrder.note;
        }
        if (privateDraftOrder?.attributes?.length) {
          privatePayload.noteAttributes = privateDraftOrder.attributes;
        }
        const ckResp = await apiFetch('/api/private/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(privatePayload),
        });
        const ck = await ckResp.json().catch(() => null);
        if (!ckResp.ok || typeof ck?.checkoutUrl !== 'string') {
          const reason = typeof ck?.error === 'string' && ck.error ? ck.error : 'private_checkout_failed';
          const err: Error & {
            reason?: string;
            friendlyMessage?: string;
            missing?: string[];
            detail?: unknown;
            status?: number;
          } = new Error(reason);
          err.reason = reason;
          if (Array.isArray(ck?.missing) && ck.missing.length) {
            err.missing = ck.missing;
          }
          if (ck?.detail) {
            err.detail = ck.detail;
          }
          const message = typeof ck?.message === 'string' ? ck.message.trim() : '';
          err.friendlyMessage = message || 'No pudimos generar el checkout privado, probá de nuevo.';
          if (typeof ckResp.status === 'number') {
            err.status = ckResp.status;
          }
          throw err;
        }
        result.checkoutUrl = ck.checkoutUrl;
        if (ck.draft_order_id) {
          result.draftOrderId = String(ck.draft_order_id);
        }
        if (ck.draft_order_name) {
          result.draftOrderName = String(ck.draft_order_name);
        }
      } else {
        const checkoutPayload: Record<string, unknown> = {
          productId,
          variantId,
          quantity: 1,
          ...(customerEmail ? { email: customerEmail } : {}),
          mode,
          ...(normalizedDiscountCode ? { discount: normalizedDiscountCode } : {}),
        };
        const ckResp = await apiFetch('/api/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(checkoutPayload),
        });
        const ck = await ckResp.json().catch(() => null);
        if (!ckResp.ok || !ck?.url) {
          const reason = typeof ck?.error === 'string' && ck.error ? ck.error : 'checkout_link_failed';
          const err: Error & {
            reason?: string;
            friendlyMessage?: string;
            missing?: string[];
            detail?: unknown;
            status?: number;
          } = new Error(reason);
          err.reason = reason;
          if (Array.isArray(ck?.missing) && ck.missing.length) {
            err.missing = ck.missing;
          }
          if (ck?.detail) {
            err.detail = ck.detail;
          }
          const message = typeof ck?.message === 'string' ? ck.message.trim() : '';
          if (message) {
            err.friendlyMessage = message;
          }
          if (typeof ckResp.status === 'number') {
            err.status = ckResp.status;
          }
          throw err;
        }
        result.checkoutUrl = ck.url;
      }
    }
    return result;
  } finally {
    if (productId || variantId || productHandle || productUrl || result.cartUrl || result.checkoutUrl) {
      flow.set({
        lastProduct: {
          productId,
          variantId,
          cartUrl: result.cartUrl,
          checkoutUrl: result.checkoutUrl,
          productUrl,
          productHandle,
          visibility: result.visibility,
          draftOrderId: result.draftOrderId,
          draftOrderName: result.draftOrderName,
          ...(collectedWarnings && collectedWarnings.length ? { warnings: collectedWarnings } : {}),
          ...(collectedWarningMessages && collectedWarningMessages.length
            ? { warningMessages: collectedWarningMessages }
            : {}),
        },
      });
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export function normalizeVariantNumericId(value?: string | number | null) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

function clampQuantity(quantity?: number) {
  if (!Number.isFinite(quantity) || !quantity) return 1;
  return Math.min(Math.max(Math.floor(quantity), 1), 99);
}

export function buildCartPermalink(
  variantId: string | number | undefined,
  quantity = 1,
  options?: { returnTo?: string | null; baseUrl?: string; discountCode?: string },
) {
  const numericId = normalizeVariantNumericId(variantId);
  if (!numericId) return '';
  const qty = clampQuantity(quantity);
  const baseRaw = typeof options?.baseUrl === 'string' && options.baseUrl.trim()
    ? options.baseUrl.trim()
    : DEFAULT_STORE_BASE;
  let cartUrl: URL;
  try {
    cartUrl = new URL(`/cart/${numericId}:${qty}`, baseRaw);
  } catch (err) {
    console.error('[buildCartPermalink] invalid base url', err);
    return '';
  }
  const rawReturn = options?.returnTo;
  if (rawReturn !== null) {
    const normalizedReturn = typeof rawReturn === 'string' && rawReturn.trim() ? rawReturn.trim() : '/cart';
    const returnTo = normalizedReturn.startsWith('/')
      ? normalizedReturn
      : `/${normalizedReturn.replace(/^\/+/, '')}`;
    cartUrl.searchParams.set('return_to', returnTo);
  }
  const discountCode = typeof options?.discountCode === 'string' ? options.discountCode.trim() : '';
  if (discountCode) {
    cartUrl.searchParams.set('discount', discountCode);
  }
  return cartUrl.toString();
}

export function buildCartAddUrl(
  variantId: string | number | undefined,
  quantity = 1,
  options?: { baseUrl?: string; discountCode?: string },
) {
  const numericId = normalizeVariantNumericId(variantId);
  if (!numericId) return '';
  const qty = clampQuantity(quantity);
  const baseRaw = typeof options?.baseUrl === 'string' && options.baseUrl.trim()
    ? options.baseUrl.trim()
    : DEFAULT_STORE_BASE;
  let cartUrl: URL;
  try {
    cartUrl = new URL('/cart/add', baseRaw);
  } catch (err) {
    console.error('[buildCartAddUrl] invalid base url', err);
    return '';
  }
  cartUrl.searchParams.set('id', numericId);
  cartUrl.searchParams.set('quantity', String(qty));
  cartUrl.searchParams.set('return_to', '/cart');
  const discountCode = typeof options?.discountCode === 'string' ? options.discountCode.trim() : '';
  if (discountCode) {
    cartUrl.searchParams.set('discount', discountCode);
  }
  return cartUrl.toString();
}

const STOREFRONT_CART_STORAGE_KEY = 'MGM_storefrontCartId';

type EnvRecord = Record<string, string | undefined>;

function readEnv(keys: string[]): string {
  const meta = (import.meta as { env?: EnvRecord }).env || {};
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  if (typeof process !== 'undefined' && typeof (process as { env?: EnvRecord }).env === 'object') {
    const procEnv = (process as { env?: EnvRecord }).env;
    if (procEnv) {
      for (const key of keys) {
        const value = procEnv[key];
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
    }
  }
  return '';
}

function normalizeStorefrontDomain(domain: string) {
  return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

interface StorefrontConfig {
  domain: string;
  token: string;
  version: string;
}

function resolveStorefrontConfig(): { ok: true; config: StorefrontConfig } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const domainRaw = readEnv(['VITE_SHOPIFY_DOMAIN', 'NEXT_PUBLIC_SHOPIFY_DOMAIN']);
  const token = readEnv(['VITE_SHOPIFY_STOREFRONT_TOKEN', 'NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN']);
  const versionRaw = readEnv(['VITE_SHOPIFY_API_VERSION', 'NEXT_PUBLIC_SHOPIFY_API_VERSION']);

  if (!domainRaw) missing.push('VITE_SHOPIFY_DOMAIN (or NEXT_PUBLIC_SHOPIFY_DOMAIN)');
  if (!token) missing.push('VITE_SHOPIFY_STOREFRONT_TOKEN (or NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN)');
  if (!versionRaw) missing.push('VITE_SHOPIFY_API_VERSION (or NEXT_PUBLIC_SHOPIFY_API_VERSION)');

  if (missing.length) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      domain: normalizeStorefrontDomain(domainRaw),
      token,
      version: versionRaw || DEFAULT_STOREFRONT_API_VERSION,
    },
  };
}

function setStoredCartId(cartId?: string | null) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (cartId && cartId.trim()) {
      window.localStorage.setItem(STOREFRONT_CART_STORAGE_KEY, cartId.trim());
    } else {
      window.localStorage.removeItem(STOREFRONT_CART_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[storefront-cart] write failed', err);
  }
}

function getStoredCartId() {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    const stored = window.localStorage.getItem(STOREFRONT_CART_STORAGE_KEY);
    return typeof stored === 'string' && stored.trim() ? stored.trim() : '';
  } catch (err) {
    console.warn('[storefront-cart] read failed', err);
    return '';
  }
}

function buildVariantGid(variantId: string | number) {
  if (typeof variantId === 'string' && variantId.startsWith('gid://shopify/ProductVariant/')) {
    return variantId;
  }
  const numeric = normalizeVariantNumericId(variantId);
  if (!numeric) {
    const err = new Error('invalid_variant_id');
    (err as Error & { reason?: string }).reason = 'invalid_variant_id';
    throw err;
  }
  return `gid://shopify/ProductVariant/${numeric}`;
}

interface StorefrontGraphQLError {
  message?: string;
  path?: (string | number | null)[] | null;
  extensions?: Record<string, unknown> | null;
}

interface StorefrontCartUserError {
  message?: string | null;
  code?: string | null;
  field?: (string | null)[] | null;
}

interface StorefrontCartPayload {
  cart?: { id?: string | null; webUrl?: string | null } | null;
  userErrors?: StorefrontCartUserError[] | null;
}

interface StorefrontCartResponse {
  cartCreate?: StorefrontCartPayload | null;
  cartLinesAdd?: StorefrontCartPayload | null;
}

interface StorefrontGraphQLResponse<T> {
  data?: T;
  errors?: StorefrontGraphQLError[];
}

async function performStorefrontGraphQL<T>(
  config: StorefrontConfig,
  query: string,
  variables: Record<string, unknown>,
) {
  const endpoint = `https://${config.domain}/api/${config.version}/graphql.json`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': config.token,
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const requestId = response.headers.get('x-request-id') || response.headers.get('X-Request-Id');
  const payload = (await response.json().catch(() => null)) as StorefrontGraphQLResponse<T> | null;
  return { response, payload, requestId: requestId || undefined };
}

function extractUserErrors(payload?: StorefrontCartPayload | null) {
  if (!payload?.userErrors?.length) return [];
  return payload.userErrors
    .map((entry) => (entry && typeof entry.message === 'string' ? entry.message.trim() : ''))
    .filter((message): message is string => Boolean(message));
}

async function performStorefrontCartMutation(
  config: StorefrontConfig,
  query: string,
  variables: Record<string, unknown>,
) {
  return performStorefrontGraphQL<StorefrontCartResponse>(config, query, variables);
}

const CART_CREATE_MUTATION = `mutation CartCreate($lines: [CartLineInput!]!, $discountCodes: [String!]) {
  cartCreate(input: { lines: $lines, discountCodes: $discountCodes }) {
    cart { id webUrl }
    userErrors { message code field }
  }
}`;

const CART_LINES_ADD_MUTATION = `mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
  cartLinesAdd(cartId: $cartId, lines: $lines) {
    cart { id webUrl }
    userErrors { message code field }
  }
}`;

const VARIANT_AVAILABILITY_QUERY = `query WaitVariant($id: ID!) {
  node(id: $id) {
    __typename
    ... on ProductVariant {
      id
      availableForSale
      quantityAvailable
      product {
        id
        handle
      }
    }
  }
}`;

export interface StorefrontCartSuccess {
  cartId: string;
  webUrl: string;
}

export async function addVariantToCartStorefront(
  variantId: string | number,
  quantity = 1,
  options: { discountCode?: string | null } = {},
): Promise<StorefrontCartSuccess> {
  const configResult = resolveStorefrontConfig();
  if (!configResult.ok) {
    try {
      console.error('[cart-flow] storefront_env_missing', { missing: configResult.missing });
    } catch (logErr) {
      console.warn?.('[cart-flow] storefront_env_missing_log_failed', logErr);
    }
    const error = new Error('shopify_storefront_env_missing');
    (error as Error & { reason?: string; missing?: string[] }).reason = 'shopify_storefront_env_missing';
    (error as Error & { reason?: string; missing?: string[] }).missing = configResult.missing;
    throw error;
  }
  if (IS_DEV) {
    try {
      console.info('[cart-flow] storefront_env_ok');
    } catch (logErr) {
      console.warn?.('[cart-flow] storefront_env_log_failed', logErr);
    }
  }
  const { config } = configResult;
  if (config.domain !== 'kw0f4u-ji.myshopify.com') {
    try {
      console.warn('[cart-flow] storefront_domain_unexpected', { domain: config.domain });
    } catch (logErr) {
      console.debug?.('[cart-flow] storefront_domain_log_failed', logErr);
    }
  }
  if (config.version !== '2024-07') {
    try {
      console.warn('[cart-flow] storefront_version_unexpected', { version: config.version });
    } catch (logErr) {
      console.debug?.('[cart-flow] storefront_version_log_failed', logErr);
    }
  }
  const merchandiseId = buildVariantGid(variantId);
  const lines = [{ merchandiseId, quantity: clampQuantity(quantity) }];
  const normalizedDiscount = typeof options?.discountCode === 'string' ? options.discountCode.trim() : '';
  const discountCodes = normalizedDiscount ? [normalizedDiscount] : undefined;
  const RETRY_DELAY_MS = 1_500;

  function buildCartError(
    context: 'cart_create' | 'cart_lines_add',
    requestId: string | undefined,
    status: number,
    userErrors: string[],
    graphQLErrors: StorefrontGraphQLError[] = [],
  ) {
    const error = new Error('shopify_cart_user_error') as Error & {
      reason?: string;
      requestId?: string;
      userErrors?: string[];
      status?: number;
      friendlyMessage?: string;
      context?: string;
    };
    error.reason = 'shopify_cart_user_error';
    if (requestId) error.requestId = requestId;
    if (Number.isFinite(status)) error.status = status;
    const combinedErrors = [
      ...userErrors,
      ...graphQLErrors
        .map((entry) => (entry?.message ? String(entry.message).trim() : ''))
        .filter((message) => Boolean(message)),
    ];
    if (combinedErrors.length) {
      error.userErrors = combinedErrors;
      const friendly = combinedErrors.join(' | ');
      if (friendly) {
        error.friendlyMessage = friendly;
      }
    }
    error.context = context;
    return error;
  }

  const attemptCartLinesAdd = async (
    cartId: string,
    attempt = 1,
  ): Promise<{ ok: true; value: StorefrontCartSuccess } | { ok: false; error: Error }> => {
    const { response, payload, requestId } = await performStorefrontCartMutation(
      config,
      CART_LINES_ADD_MUTATION,
      { cartId, lines },
    );
    const data = payload?.data?.cartLinesAdd;
    const userErrors = extractUserErrors(data);
    const payloadErrors = Array.isArray(payload?.errors) ? payload.errors.filter(Boolean) : [];
    const resolvedCartId = data?.cart?.id ? String(data.cart.id) : cartId;
    const resolvedWebUrl = data?.cart?.webUrl ? String(data.cart.webUrl) : '';
    if (response.ok && !payloadErrors.length && !userErrors.length && resolvedCartId && resolvedWebUrl) {
      setStoredCartId(resolvedCartId);
      try {
        console.info('[cart-flow] cart_lines_add_ok', { cartId: resolvedCartId, webUrl: resolvedWebUrl });
      } catch (logErr) {
        console.warn?.('[cart-flow] cart_lines_add_log_failed', logErr);
      }
      return { ok: true, value: { cartId: resolvedCartId, webUrl: resolvedWebUrl } };
    }

    try {
      console.error('[cart-flow] cart_lines_add_error', {
        requestId,
        status: response.status,
        userErrors,
        graphQLErrors: payloadErrors,
      });
    } catch (logErr) {
      console.warn?.('[cart-flow] cart_lines_add_log_failed', logErr);
    }

    if (userErrors.length && attempt < 2) {
      await sleep(RETRY_DELAY_MS);
      return attemptCartLinesAdd(cartId, attempt + 1);
    }

    const error = buildCartError('cart_lines_add', requestId, response.status, userErrors, payloadErrors);
    return { ok: false, error };
  };

  const attemptCartCreate = async (
    attempt = 1,
  ): Promise<{ ok: true; value: StorefrontCartSuccess } | { ok: false; error: Error }> => {
    const variables = discountCodes?.length ? { lines, discountCodes } : { lines };
    const { response, payload, requestId } = await performStorefrontCartMutation(
      config,
      CART_CREATE_MUTATION,
      variables,
    );
    const data = payload?.data?.cartCreate;
    const userErrors = extractUserErrors(data);
    const payloadErrors = Array.isArray(payload?.errors) ? payload.errors.filter(Boolean) : [];
    const createdCartId = data?.cart?.id ? String(data.cart.id) : '';
    const createdWebUrl = data?.cart?.webUrl ? String(data.cart.webUrl) : '';
    if (response.ok && !payloadErrors.length && !userErrors.length && createdCartId && createdWebUrl) {
      setStoredCartId(createdCartId);
      try {
        console.info('[cart-flow] cart_create_ok', { cartId: createdCartId, webUrl: createdWebUrl });
      } catch (logErr) {
        console.warn?.('[cart-flow] cart_create_log_failed', logErr);
      }
      return { ok: true, value: { cartId: createdCartId, webUrl: createdWebUrl } };
    }

    try {
      console.error('[cart-flow] cart_create_error', {
        requestId,
        status: response.status,
        userErrors,
        graphQLErrors: payloadErrors,
      });
    } catch (logErr) {
      console.warn?.('[cart-flow] cart_create_log_failed', logErr);
    }

    if (userErrors.length && attempt < 2) {
      await sleep(RETRY_DELAY_MS);
      return attemptCartCreate(attempt + 1);
    }

    const error = buildCartError('cart_create', requestId, response.status, userErrors, payloadErrors);
    return { ok: false, error };
  };

  let lastError: Error | null = null;
  const storedCartId = getStoredCartId();
  if (storedCartId) {
    const addResult = await attemptCartLinesAdd(storedCartId);
    if (addResult.ok) {
      return addResult.value;
    }
    lastError = addResult.error;
    setStoredCartId(null);
  }

  const createResult = await attemptCartCreate();
  if (createResult.ok) {
    return createResult.value;
  }

  lastError = createResult.error || lastError;
  if (lastError) {
    throw lastError;
  }
  const fallbackError = new Error('shopify_cart_user_error');
  (fallbackError as Error & { reason?: string }).reason = 'shopify_cart_user_error';
  throw fallbackError;
}

export interface EnsurePublicationResponse {
  ok: boolean;
  published?: boolean;
  publicationId?: string | null;
  [key: string]: unknown;
}

export async function ensureProductPublication(productId?: string | null): Promise<EnsurePublicationResponse> {
  if (!productId) {
    return { ok: false, published: false };
  }
  const resp = await apiFetch('/api/ensure-product-publication', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId }),
  });
  const json: EnsurePublicationResponse | null = await resp.json().catch(() => null);
  if (!resp.ok || !json?.ok) {
    const error = new Error(json?.error ? String(json.error) : `ensure_publication_${resp.status}`);
    (error as Error & { response?: unknown }).response = json;
    throw error;
  }
  try {
    if (Array.isArray(json.recoveries) && json.recoveries.includes('publication_missing_detected')) {
      console.info('[cart-flow] publication_missing detectado', json.recoveries);
    }
    if (json.publicationId && typeof json.publicationIdSource === 'string') {
      const source = json.publicationIdSource;
      if (source && source !== 'env') {
        console.info('[cart-flow] publicationId elegido dinámicamente', { id: json.publicationId, source });
      }
    }
    if (typeof json.publishAttempts === 'number' && Number.isFinite(json.publishAttempts)) {
      console.info('[cart-flow] publish attempts', json.publishAttempts);
    }
  } catch (logErr) {
    console.debug?.('[ensureProductPublication] log_failed', logErr);
  }
  return json;
}

export interface ProductPublicationStatusResponse {
  ok: boolean;
  published?: boolean;
  productId?: string | null;
  [key: string]: unknown;
}

export async function verifyProductPublicationStatus(productId?: string | number | null) {
  if (productId == null) {
    return false;
  }
  const normalized = typeof productId === 'string' ? productId.trim() : String(productId);
  if (!normalized) {
    return false;
  }
  const resp = await apiFetch('/api/product-publication-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: normalized }),
  });
  const json: ProductPublicationStatusResponse | null = await resp.json().catch(() => null);
  if (!resp.ok || !json?.ok) {
    try {
      console.warn('[verifyProductPublicationStatus] request_failed', {
        status: resp.status,
        body: json,
      });
    } catch (logErr) {
      console.debug?.('[verifyProductPublicationStatus] log_failed', logErr);
    }
    return false;
  }
  return json.published === true;
}

interface VariantPollData {
  node?: {
    __typename?: string | null;
    id?: string | null;
    availableForSale?: boolean | null;
    quantityAvailable?: number | null;
    product?: {
      id?: string | null;
      handle?: string | null;
      onlineStoreUrl?: string | null;
    } | null;
  } | null;
}

const DEFAULT_VARIANT_POLL_DELAYS_MS = [
  1_200,
  2_000,
  2_000,
  3_000,
  3_000,
  4_000,
  4_000,
  5_000,
];

const VARIANT_POLL_INITIAL_DELAY_MS = 700;
const VARIANT_ADDITIONAL_ATTEMPTS = 2;
const VARIANT_ADDITIONAL_DELAY_MS = 2_000;

export interface WaitVariantOptions {
  signal?: AbortSignal;
  verifyProductPublication?: (() => Promise<boolean>) | null;
  retryProductPublication?: (() => Promise<unknown>) | null;
  attemptDelaysMs?: number[];
  initialDelayMs?: number;
}

export async function waitForVariantAvailability(
  variantId: string | number,
  _productId?: string | number,
  options: WaitVariantOptions = {},
) {
  const { signal, verifyProductPublication, retryProductPublication } = options;
  const numericVariant = normalizeVariantNumericId(variantId);
  if (!numericVariant) {
    throw new Error('invalid_variant_id');
  }
  const configResult = resolveStorefrontConfig();
  if (!configResult.ok) {
    try {
      console.warn('[waitForVariantAvailability] storefront env missing', { missing: configResult.missing });
    } catch (logErr) {
      console.warn?.('[waitForVariantAvailability] env_log_failed', logErr);
    }
    return {
      ready: true,
      available: true,
      timedOut: false,
      attempts: 0,
      lastResponse: null,
      variantPresent: true,
      availableForSale: true,
      productHandle: null,
      quantityAvailable: null,
    };
  }
  const { config } = configResult;
  const variantGid = buildVariantGid(numericVariant);
  const pollSchedule = Array.isArray(options.attemptDelaysMs) && options.attemptDelaysMs.length
    ? options.attemptDelaysMs
        .map((value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0))
        .filter((value) => value >= 0)
    : DEFAULT_VARIANT_POLL_DELAYS_MS;
  const normalizedSchedule = pollSchedule.length ? pollSchedule : DEFAULT_VARIANT_POLL_DELAYS_MS;
  const preDelayMs = Number.isFinite(options.initialDelayMs)
    ? Math.max(0, Math.floor((options.initialDelayMs as number) || 0))
    : VARIANT_POLL_INITIAL_DELAY_MS;

  if (signal?.aborted) {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }
  if (preDelayMs > 0) {
    await sleep(preDelayMs);
    if (signal?.aborted) {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
  }

  let attempt = 0;
  let lastResponse: VariantPollData | null = null;
  let lastVariantPresent = false;
  let lastAvailableForSale = false;
  let lastProductHandle: string | null = null;
  let lastQuantityAvailable: number | null = null;

  const runStorefrontPoll = async (attemptNumber: number) => {
    try {
      const { response, payload, requestId } = await performStorefrontGraphQL<VariantPollData>(
        config,
        VARIANT_AVAILABILITY_QUERY,
        { id: variantGid },
      );
      const data = payload?.data || null;
      lastResponse = data;
      const node = data?.node;
      const variantNode =
        node && (node.__typename === 'ProductVariant' || typeof node?.availableForSale !== 'undefined')
          ? node
          : null;
      const variantPresent = Boolean(variantNode && typeof variantNode.id === 'string' && variantNode.id);
      const availableForSale = Boolean(variantNode && variantNode.availableForSale === true);
      const productHandleValue = variantNode?.product?.handle
        ? String(variantNode.product.handle)
        : '';
      const quantityAvailableValue =
        typeof variantNode?.quantityAvailable === 'number' && Number.isFinite(variantNode.quantityAvailable)
          ? variantNode.quantityAvailable
          : null;

      lastVariantPresent = variantPresent;
      lastAvailableForSale = availableForSale;
      if (productHandleValue) {
        lastProductHandle = productHandleValue;
      }
      if (quantityAvailableValue != null) {
        lastQuantityAvailable = quantityAvailableValue;
      }

      const payloadErrors = Array.isArray(payload?.errors) ? payload.errors.filter(Boolean) : [];
      if (payloadErrors.length) {
        try {
          const normalizedErrors = payloadErrors.map((error) => ({
            message: error?.message ? String(error.message) : '',
            path: Array.isArray(error?.path) ? error.path : undefined,
          }));
          console.warn('waitForVariantAvailability storefront errors:', normalizedErrors);
        } catch (logErr) {
          console.warn?.('[waitForVariantAvailability] error_log_failed', logErr);
        }
      }
      if (!response.ok) {
        try {
          console.warn('[waitForVariantAvailability] storefront response issue', {
            status: response.status,
            requestId,
          });
        } catch (logErr) {
          console.warn?.('[waitForVariantAvailability] response_issue_log_failed', logErr);
        }
      }

      try {
        const logPayload: Record<string, unknown> = { attempt: attemptNumber, availableForSale };
        const handleForLog = productHandleValue || lastProductHandle;
        if (handleForLog) {
          logPayload.productHandle = handleForLog;
        }
        console.info('[cart-flow] variant_poll', logPayload);
      } catch (logErr) {
        console.warn?.('[waitForVariantAvailability] poll_log_failed', logErr);
      }

      return { availableForSale, variantPresent };
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      console.error('[waitForVariantAvailability] poll error', error);
      return { availableForSale: false, variantPresent: false };
    }
  };

  const maxAttempts = Math.max(1, normalizedSchedule.length);
  while (attempt < maxAttempts) {
    if (signal?.aborted) {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    attempt += 1;
    const pollOutcome = await runStorefrontPoll(attempt);
    if (pollOutcome.availableForSale && lastVariantPresent) {
      return {
        ready: true,
        available: true,
        timedOut: false,
        attempts: attempt,
        lastResponse,
        variantPresent: lastVariantPresent,
        availableForSale: lastAvailableForSale,
        productHandle: lastProductHandle,
        quantityAvailable: lastQuantityAvailable,
      };
    }
    if (attempt >= maxAttempts) {
      break;
    }
    const delayMs = normalizedSchedule[Math.min(attempt - 1, normalizedSchedule.length - 1)] || 0;
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  let republishAttempted = false;
  if (!lastAvailableForSale && typeof verifyProductPublication === 'function') {
    try {
      const adminPublished = await verifyProductPublication();
      try {
        console.info('[cart-flow] admin_publication_check', { adminPublished });
      } catch (logErr) {
        console.warn?.('[waitForVariantAvailability] admin_check_log_failed', logErr);
      }
      if (adminPublished === false && typeof retryProductPublication === 'function') {
        try {
          await retryProductPublication();
          republishAttempted = true;
          try {
            console.info('[cart-flow] admin_publication_retry', { attempted: true });
          } catch (logErr) {
            console.warn?.('[waitForVariantAvailability] admin_retry_log_failed', logErr);
          }
        } catch (adminErr) {
          console.error('[waitForVariantAvailability] admin_publication_retry_failed', adminErr);
        }
      }
    } catch (adminErr) {
      console.error('[waitForVariantAvailability] admin_publication_check_failed', adminErr);
    }
  }

  if (republishAttempted) {
    for (let extra = 0; extra < VARIANT_ADDITIONAL_ATTEMPTS; extra += 1) {
      if (signal?.aborted) {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }
      await sleep(VARIANT_ADDITIONAL_DELAY_MS);
      if (signal?.aborted) {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }
      attempt += 1;
      const pollOutcome = await runStorefrontPoll(attempt);
      if (pollOutcome.availableForSale && lastVariantPresent) {
        return {
          ready: true,
          available: true,
          timedOut: false,
          attempts: attempt,
          lastResponse,
          variantPresent: lastVariantPresent,
          availableForSale: lastAvailableForSale,
          productHandle: lastProductHandle,
          quantityAvailable: lastQuantityAvailable,
        };
      }
    }
  }

  return {
    ready: false,
    available: false,
    timedOut: true,
    attempts: attempt,
    lastResponse,
    variantPresent: lastVariantPresent,
    availableForSale: lastAvailableForSale,
    productHandle: lastProductHandle,
    quantityAvailable: lastQuantityAvailable,
  };
}
