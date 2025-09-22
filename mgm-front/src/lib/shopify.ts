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
  const priceTransfer = safeNumber(flow.priceTransfer);
  const priceNormal = safeNumber(flow.priceNormal);
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

  const isPrivate = mode === 'private';
  const requestedVisibility: 'public' | 'private' = isPrivate ? 'private' : 'public';

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
    productId?: string;
    variantId?: string;
    productUrl?: string;
    visibility: 'public' | 'private';
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
        visibility: result.visibility,
      },
    });
  }
}
