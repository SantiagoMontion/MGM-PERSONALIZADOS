import { apiFetch } from './api';
import { FlowState } from '@/state/flow';

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

export async function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onloadend = () => res(typeof r.result === 'string' ? r.result : '');
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

export async function createJobAndProduct(mode: 'checkout' | 'cart', flow: FlowState) {
  if (!flow.mockupBlob) throw new Error('missing_mockup');
  const mockupDataUrl = await blobToBase64(flow.mockupBlob);
  const productType = flow.productType === 'glasspad' ? 'glasspad' : 'mousepad';
  const productLabel = PRODUCT_LABELS[productType];
  const designName = (flow.designName || '').trim();
  const productTitle = designName
    ? `${productLabel} personalizado - ${designName}`
    : `${productLabel} personalizado`;
  const widthCm = safeNumber((flow.editorState as any)?.size_cm?.w);
  const heightCm = safeNumber((flow.editorState as any)?.size_cm?.h);
  const approxDpi = safeNumber(flow.approxDpi);
  const priceTransfer = safeNumber(flow.priceTransfer);
  const priceNormal = safeNumber(flow.priceNormal);
  const priceCurrencyRaw = typeof flow.priceCurrency === 'string' ? flow.priceCurrency : 'ARS';
  const priceCurrency = priceCurrencyRaw.trim() || 'ARS';
  const extraTags: string[] = [`currency-${priceCurrency.toLowerCase()}`];
  if (flow.lowQualityAck) extraTags.push('calidad-baja');
  const filename = `${slugify(designName || productTitle)}.png`;
  const imageAlt = `Mockup ${productTitle}`;

  const publishResp = await apiFetch('/api/publish-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productType,
      mockupDataUrl,
      designName,
      title: productTitle,
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
    productId?: string;
    variantId?: string;
    productUrl?: string;
  } = {
    productId,
    variantId,
    productUrl: publish.productUrl,
  };

  try {
    if (mode === 'checkout') {
      const ckResp = await apiFetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          quantity: 1,
        }),
      });
      const ck = await ckResp.json().catch(() => null);
      if (!ckResp.ok || !ck?.url) {
        throw new Error('checkout_link_failed');
      }
      result.checkoutUrl = ck.url;
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
        throw new Error('cart_link_failed');
      }
      result.cartUrl = cl.url;
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
      },
    });
  }
}
