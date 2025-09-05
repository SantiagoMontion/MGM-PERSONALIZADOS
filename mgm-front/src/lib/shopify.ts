import { apiFetch } from './api';
import { FlowState } from '@/state/flow';

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
  const publish = await apiFetch('/api/publish-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productType: flow.productType,
      mockupDataUrl,
    }),
  }).then((r) => r.json());

  if (!publish?.ok) throw new Error(publish?.error || 'publish_failed');

  let result: { checkoutUrl?: string; cartUrl?: string; productId?: string; variantId?: string } = {
    productId: publish.productId,
    variantId: publish.variantId,
  };

  if (mode === 'checkout') {
    const ck = await apiFetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: publish.productId,
        variantId: publish.variantId,
        quantity: 1,
      }),
    }).then((r) => r.json());
    if (ck?.url) result.checkoutUrl = ck.url;
  } else {
    const cl = await apiFetch('/api/create-cart-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: publish.productId,
        variantId: publish.variantId,
        quantity: 1,
      }),
    }).then((r) => r.json());
    if (cl?.url) result.cartUrl = cl.url;
  }

  flow.set({ lastProduct: { ...result } });
  return result;
}
