import { apiFetch } from './api';
import { FlowState } from '@/state/flow';

const DEFAULT_STORE_BASE = 'https://www.mgmgamers.store';
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
  } = options;
  const lastProduct = flow.lastProduct;
  const isPrivate = mode === 'private';
  const requestedVisibility: 'public' | 'private' = isPrivate ? 'private' : 'public';
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
      const checkoutPayload: Record<string, unknown> = {
        productId,
        variantId,
        quantity: 1,
        ...(customerEmail ? { email: customerEmail } : {}),
        ...(isPrivate ? { mode: 'private' as const } : { mode }),
      };
      if (isPrivate && privateDraftOrder?.note) {
        checkoutPayload.note = privateDraftOrder.note;
      }
      if (isPrivate && privateDraftOrder?.attributes?.length) {
        checkoutPayload.noteAttributes = privateDraftOrder.attributes;
      }
      const ckResp = await apiFetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutPayload),
      });
      const ck = await ckResp.json().catch(() => null);
      if (!ckResp.ok || !ck?.url) {
        const reason = typeof ck?.error === 'string' && ck.error
          ? ck.error
          : isPrivate
            ? 'private_checkout_failed'
            : 'checkout_link_failed';
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
        } else if (isPrivate) {
          err.friendlyMessage = 'No pudimos generar el checkout privado, probá de nuevo.';
        }
        if (typeof ckResp.status === 'number') {
          err.status = ckResp.status;
        }
        throw err;
      }
      result.checkoutUrl = ck.url;
      if (ck.draft_order_id) {
        result.draftOrderId = String(ck.draft_order_id);
      }
      if (ck.draft_order_name) {
        result.draftOrderName = String(ck.draft_order_name);
      }
    } else {
      const clResp = await apiFetch('/api/create-cart-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          quantity: 1,
        }),
      });
      const cl = await clResp.json().catch(() => null);
      if (!clResp.ok || !cl?.url) {
        const reason = typeof cl?.error === 'string' && cl.error ? cl.error : 'cart_link_failed';
        const err: Error & { reason?: string; friendlyMessage?: string; missing?: string[]; detail?: unknown } = new Error(reason);
        err.reason = reason;
        if (Array.isArray(cl?.missing) && cl.missing.length) {
          err.missing = cl.missing;
        }
        if (typeof cl?.message === 'string' && cl.message.trim()) {
          err.friendlyMessage = cl.message.trim();
        }
        if (cl?.detail) {
          err.detail = cl.detail;
        }
        throw err;
      }
      result.cartUrl = cl.url;
      if (typeof cl.checkout_url_now === 'string' && cl.checkout_url_now) {
        result.checkoutUrl = cl.checkout_url_now;
      }
      if (typeof cl.cart_plain === 'string' && cl.cart_plain) {
        result.cartPlain = cl.cart_plain;
      }
      if (typeof cl.cart_id === 'string' && cl.cart_id) {
        result.cartId = cl.cart_id;
      }
      if (typeof cl.cart_token === 'string' && cl.cart_token) {
        result.cartToken = cl.cart_token;
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

function normalizeVariantNumericId(value?: string | number | null) {
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
  options?: { returnTo?: string; baseUrl?: string },
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
  const rawReturn = typeof options?.returnTo === 'string' ? options.returnTo.trim() : '';
  const returnTo = rawReturn || '/cart';
  cartUrl.searchParams.set('return_to', returnTo.startsWith('/') ? returnTo : `/${returnTo.replace(/^\/+/, '')}`);
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
  const domainRaw = readEnv([
    'VITE_SHOPIFY_STOREFRONT_DOMAIN',
    'VITE_SHOPIFY_DOMAIN',
    'NEXT_PUBLIC_SHOPIFY_STOREFRONT_DOMAIN',
    'NEXT_PUBLIC_SHOPIFY_DOMAIN',
    'SHOPIFY_STOREFRONT_DOMAIN',
    'SHOPIFY_DOMAIN',
  ]);
  const token = readEnv([
    'VITE_SHOPIFY_STOREFRONT_TOKEN',
    'NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN',
    'SHOPIFY_STOREFRONT_TOKEN',
  ]);
  const version = readEnv([
    'VITE_SHOPIFY_STOREFRONT_API_VERSION',
    'NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_VERSION',
    'SHOPIFY_STOREFRONT_API_VERSION',
    'VITE_SHOPIFY_API_VERSION',
    'SHOPIFY_API_VERSION',
  ]) || DEFAULT_STOREFRONT_API_VERSION;

  if (!domainRaw) missing.push('NEXT_PUBLIC_SHOPIFY_DOMAIN');
  if (!token) missing.push('NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN');
  if (!version) missing.push('NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_VERSION');

  if (missing.length) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      domain: normalizeStorefrontDomain(domainRaw),
      token,
      version,
    },
  };
}

function getStoredCartId(): string {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    const value = window.localStorage.getItem(STOREFRONT_CART_STORAGE_KEY);
    return value ? value.trim() : '';
  } catch (err) {
    console.warn('[storefront-cart] read failed', err);
    return '';
  }
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
  const payload = (await response.json().catch(() => null)) as StorefrontGraphQLResponse<StorefrontCartResponse> | null;
  return { response, payload, requestId: requestId || undefined };
}

const CART_CREATE_MUTATION = `mutation CartCreate($lines: [CartLineInput!]!) {
  cartCreate(input: { lines: $lines }) {
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

export interface StorefrontCartSuccess {
  cartId: string;
  webUrl: string;
}

export async function addVariantToCartStorefront(
  variantId: string | number,
  quantity = 1,
): Promise<StorefrontCartSuccess> {
  const configResult = resolveStorefrontConfig();
  if (!configResult.ok) {
    const error = new Error('shopify_storefront_env_missing');
    (error as Error & { reason?: string; missing?: string[] }).reason = 'shopify_storefront_env_missing';
    (error as Error & { reason?: string; missing?: string[] }).missing = configResult.missing;
    throw error;
  }
  const { config } = configResult;
  const merchandiseId = buildVariantGid(variantId);
  const lines = [{ merchandiseId, quantity: clampQuantity(quantity) }];

  const attemptAdd = async (cartId: string) => {
    const { response, payload, requestId } = await performStorefrontCartMutation(
      config,
      CART_LINES_ADD_MUTATION,
      { cartId, lines },
    );
    const data = payload?.data?.cartLinesAdd;
    const userErrors = extractUserErrors(data);
    if (!response.ok || payload?.errors?.length || userErrors.length) {
      const error = new Error('shopify_storefront_user_error');
      (error as Error & { reason?: string; requestId?: string; userErrors?: string[] }).reason = 'shopify_storefront_user_error';
      if (requestId) (error as Error & { requestId?: string }).requestId = requestId;
      if (userErrors.length) {
        (error as Error & { userErrors?: string[] }).userErrors = userErrors;
      }
      if (payload?.errors?.length) {
        const messages = payload.errors
          .map((entry) => (entry?.message ? String(entry.message).trim() : ''))
          .filter(Boolean);
        if (messages.length) {
          const combined = messages.join(' | ');
          (error as Error & { userErrors?: string[] }).userErrors = [
            ...((error as Error & { userErrors?: string[] }).userErrors || []),
            combined,
          ];
        }
      }
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    const cartIdResult = data?.cart?.id ? String(data.cart.id) : '';
    const webUrl = data?.cart?.webUrl ? String(data.cart.webUrl) : '';
    if (!cartIdResult || !webUrl) {
      const error = new Error('shopify_storefront_cart_missing');
      (error as Error & { reason?: string; requestId?: string }).reason = 'shopify_storefront_cart_missing';
      if (requestId) (error as Error & { requestId?: string }).requestId = requestId;
      throw error;
    }
    setStoredCartId(cartIdResult);
    return { cartId: cartIdResult, webUrl };
  };

  const storedCartId = getStoredCartId();
  if (storedCartId) {
    try {
      return await attemptAdd(storedCartId);
    } catch (error) {
      setStoredCartId(null);
      const reason = typeof (error as { reason?: unknown })?.reason === 'string'
        ? String((error as { reason?: unknown }).reason)
        : '';
      if (reason === 'shopify_storefront_env_missing') {
        throw error;
      }
      if (reason === 'shopify_storefront_user_error') {
        throw error;
      }
    }
  }

  const { response, payload, requestId } = await performStorefrontCartMutation(
    config,
    CART_CREATE_MUTATION,
    { lines },
  );
  const data = payload?.data?.cartCreate;
  const userErrors = extractUserErrors(data);
  if (!response.ok || payload?.errors?.length || userErrors.length) {
    const error = new Error('shopify_storefront_user_error');
    (error as Error & { reason?: string; requestId?: string; userErrors?: string[] }).reason = 'shopify_storefront_user_error';
    if (requestId) (error as Error & { requestId?: string }).requestId = requestId;
    if (userErrors.length) (error as Error & { userErrors?: string[] }).userErrors = userErrors;
    if (payload?.errors?.length) {
      const messages = payload.errors
        .map((entry) => (entry?.message ? String(entry.message).trim() : ''))
        .filter(Boolean);
      if (messages.length) {
        (error as Error & { userErrors?: string[] }).userErrors = [
          ...((error as Error & { userErrors?: string[] }).userErrors || []),
          messages.join(' | '),
        ];
      }
    }
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const cartIdResult = data?.cart?.id ? String(data.cart.id) : '';
  const webUrl = data?.cart?.webUrl ? String(data.cart.webUrl) : '';
  if (!cartIdResult || !webUrl) {
    const error = new Error('shopify_storefront_cart_missing');
    (error as Error & { reason?: string; requestId?: string }).reason = 'shopify_storefront_cart_missing';
    if (requestId) (error as Error & { requestId?: string }).requestId = requestId;
    throw error;
  }
  setStoredCartId(cartIdResult);
  return { cartId: cartIdResult, webUrl };
}

export interface AjaxCartSuccess {
  webUrl: string;
}

export async function addVariantToCartAjax(
  variantId: string | number,
  quantity = 1,
): Promise<AjaxCartSuccess> {
  const numericId = normalizeVariantNumericId(variantId);
  if (!numericId) {
    const error = new Error('invalid_variant_id');
    (error as Error & { reason?: string }).reason = 'invalid_variant_id';
    throw error;
  }
  const endpoint = `${DEFAULT_STORE_BASE.replace(/\/+$/, '')}/cart/add.js`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ id: Number(numericId), quantity: clampQuantity(quantity) }),
  });
  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      try {
        detail = await response.text();
      } catch {
        detail = null;
      }
    }
    const error = new Error('shopify_ajax_cart_failed');
    (error as Error & { reason?: string; detail?: unknown; status?: number }).reason = 'shopify_ajax_cart_failed';
    (error as Error & { detail?: unknown }).detail = detail;
    (error as Error & { status?: number }).status = response.status;
    const requestId = response.headers.get('x-request-id') || response.headers.get('X-Request-Id');
    if (requestId) (error as Error & { requestId?: string }).requestId = requestId;
    throw error;
  }
  return { webUrl: `${DEFAULT_STORE_BASE.replace(/\/+$/, '')}/cart` };
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

export interface VariantStatusSuccess {
  ok: true;
  ready?: boolean;
  published?: boolean;
  available?: boolean;
  variantPublished?: boolean;
  productPublished?: boolean;
  [key: string]: unknown;
}

export interface VariantStatusError {
  ok: false;
  error?: string;
  [key: string]: unknown;
}

export type VariantStatusResponse = VariantStatusSuccess | VariantStatusError | null;

export interface WaitVariantOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

export async function waitForVariantAvailability(
  variantId: string | number,
  productId?: string | number,
  options: WaitVariantOptions = {},
) {
  const { timeoutMs = 45_000, initialDelayMs = 600, maxDelayMs = 2_400, signal } = options;
  const numericVariant = normalizeVariantNumericId(variantId);
  if (!numericVariant) {
    throw new Error('invalid_variant_id');
  }
  const normalizedProductId = typeof productId === 'string'
    ? productId.trim()
    : typeof productId === 'number'
      ? String(productId)
      : '';
  if (!normalizedProductId) {
    throw new Error('invalid_product_id');
  }
  const payload: Record<string, unknown> = { variantId: numericVariant, productId: normalizedProductId };
  const start = Date.now();
  let attempt = 0;
  let delay = Math.max(200, initialDelayMs);
  let lastResponse: VariantStatusResponse = null;

  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    attempt += 1;
    try {
      const resp = await apiFetch('/api/variant-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => null);
      lastResponse = json;
      if (resp.ok && json?.ok) {
        const ready = Boolean(json.ready || (json.variantPresent && json.available));
        if (typeof console !== 'undefined' && typeof console.info === 'function') {
          console.info('[cart-flow] poll variant', {
            attempt,
            ready,
            variantPresent: json.variantPresent,
            available: json.available,
            nextDelayMs: Math.min(delay * 2, maxDelayMs),
          });
        }
        if (ready) {
          if (typeof console !== 'undefined' && typeof console.info === 'function') {
            console.info('[cart-flow] variant disponible en Storefront', { attempt });
          }
          return { ready: true, timedOut: false, attempts: attempt, lastResponse: json };
        }
      } else if (resp.status >= 500) {
        console.warn('[waitForVariantAvailability] transient error', resp.status);
      } else {
        const error = new Error(json?.error ? String(json.error) : `variant_status_${resp.status}`);
        (error as Error & { response?: unknown }).response = json;
        throw error;
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      console.error('[waitForVariantAvailability] poll error', err);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, maxDelayMs);
  }
  return { ready: false, timedOut: true, attempts: attempt, lastResponse };
}
