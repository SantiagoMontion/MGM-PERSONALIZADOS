import { apiFetch } from './api';
import { FlowState } from '@/state/flow';

const DEFAULT_STORE_BASE = 'https://www.mgmgamers.store';

const PRODUCT_LABELS = {
  mousepad: 'Mousepad',
  glasspad: 'Glasspad',
} as const;

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

export async function createJobAndProduct(mode: 'checkout' | 'cart' | 'private', flow: FlowState) {
  if (!flow.mockupBlob) throw new Error('missing_mockup');
  const mockupDataUrl = await blobToBase64(flow.mockupBlob);
  const productType = flow.productType === 'glasspad' ? 'glasspad' : 'mousepad';
  const productLabel = PRODUCT_LABELS[productType];
  const designName = (flow.designName || '').trim();
  const materialLabel = (flow.material || '').trim() || (productType === 'glasspad' ? 'Glasspad' : '');
  const widthCm = safeNumber((flow.editorState as any)?.size_cm?.w);
  const heightCm = safeNumber((flow.editorState as any)?.size_cm?.h);
  const approxDpi = safeNumber(flow.approxDpi);
  const priceTransferRaw = safeNumber(flow.priceTransfer);
  const priceNormalRaw = safeNumber(flow.priceNormal);
  const priceCurrencyRaw = typeof flow.priceCurrency === 'string' ? flow.priceCurrency : 'ARS';
  const priceCurrency = priceCurrencyRaw.trim() || 'ARS';
  const measurementLabel = formatMeasurement(widthCm, heightCm);
  const productTitle = productType === 'glasspad'
    ? buildGlasspadTitle(designName, measurementLabel)
    : buildDefaultTitle(productLabel, designName, measurementLabel, materialLabel);
  const metaDescription = buildMetaDescription(productLabel, designName, measurementLabel, materialLabel);

  const extraTags: string[] = [`currency-${priceCurrency.toLowerCase()}`];
  if (materialLabel) {
    const materialTag = materialLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (materialTag) extraTags.push(`material-${materialTag}`);
  }
  if (flow.lowQualityAck) extraTags.push('calidad-baja');
  const filename = `${slugify(designName || productTitle)}.png`;
  const imageAlt = `Mockup ${productTitle}`;

  const customerEmail = typeof flow.customerEmail === 'string' ? flow.customerEmail.trim() : '';
  const isPrivate = mode === 'private';
  const requestedVisibility: 'public' | 'private' = isPrivate ? 'private' : 'public';

  let priceTransfer = priceTransferRaw;
  let priceNormal = priceNormalRaw;

  if (isPrivate) {
    const markupFactor = 1.25;
    const applyMarkup = (value?: number) => {
      if (typeof value !== 'number') return value;
      return Math.round(value * markupFactor * 100) / 100;
    };
    priceTransfer = applyMarkup(priceTransferRaw);
    priceNormal = applyMarkup(priceNormalRaw);
  }

  if (isPrivate) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(customerEmail)) {
      const err: Error & { reason?: string } = new Error('missing_customer_email');
      err.reason = 'missing_customer_email';
      throw err;
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
      priceTransfer,
      priceNormal,
      priceCurrency,
      lowQualityAck: Boolean(flow.lowQualityAck),
      imageAlt,
      filename,
      tags: extraTags,
      description: '',
      seoDescription: metaDescription,
      visibility: requestedVisibility,
    }),
  });
  const publish = await publishResp.json().catch(() => null);
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
    throw err;
  }

  const productId: string | undefined = publish.productId ? String(publish.productId) : undefined;
  const variantId: string | undefined = publish.variantId ? String(publish.variantId) : undefined;
  if (!variantId) {
    flow.set({ lastProduct: { productId, productUrl: publish.productUrl, productHandle: publish.productHandle } });
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
  } = {
    productId,
    variantId,
    productUrl: publish.productUrl,
    visibility: publish?.visibility === 'private' ? 'private' : requestedVisibility,
  };

  try {
    if (mode === 'checkout' || isPrivate) {
      const ckResp = await apiFetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          quantity: 1,
          ...(customerEmail ? { email: customerEmail } : {}),
          ...(isPrivate ? { mode: 'private' as const } : { mode: mode }),
        }),
      });
      const ck = await ckResp.json().catch(() => null);
      if (!ckResp.ok || !ck?.url) {
        throw new Error('checkout_link_failed');
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
    flow.set({
      lastProduct: {
        productId,
        variantId,
        cartUrl: result.cartUrl,
        checkoutUrl: result.checkoutUrl,
        productUrl: publish.productUrl,
        productHandle: publish.productHandle,
        visibility: result.visibility,
        draftOrderId: result.draftOrderId,
        draftOrderName: result.draftOrderName,
      },
    });
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
  const { timeoutMs = 30_000, initialDelayMs = 600, maxDelayMs = 4_000, signal } = options;
  const numericVariant = normalizeVariantNumericId(variantId);
  if (!numericVariant) {
    throw new Error('invalid_variant_id');
  }
  const payload: Record<string, unknown> = { variantId: numericVariant };
  if (productId != null) {
    payload.productId = productId;
  }
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
        const ready = Boolean(json.ready || (json.published && json.available));
        if (ready) {
          return { ready: true, timedOut: false, attempts: attempt, lastResponse: json };
        }
      } else if (resp.status === 404) {
        // Variant not found yet; continue polling
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
    delay = Math.min(Math.floor(delay * 1.6), maxDelayMs);
  }
  return { ready: false, timedOut: true, attempts: attempt, lastResponse };
}
