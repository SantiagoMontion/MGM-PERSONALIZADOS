import { getPublicStorefrontBase } from '../publicStorefront.js';

function clampQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

export function idVariantGidToNumeric(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const segments = raw.split('/');
  const last = segments[segments.length - 1];
  if (last && /^\d+$/.test(last)) return last;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

export function buildOnlineStorePermalink({ variantNumericId, quantity = 1, discountCode } = {}) {
  const numericId = typeof variantNumericId === 'string' && variantNumericId.trim()
    ? variantNumericId.trim()
    : idVariantGidToNumeric(variantNumericId);
  if (!numericId) return '';

  const base = getPublicStorefrontBase();
  if (!base) return '';

  try {
    const url = new URL(`/cart/${numericId}:${clampQuantity(quantity)}`, base);
    const code = typeof discountCode === 'string' ? discountCode.trim() : '';
    if (code) {
      url.searchParams.set('discount', code);
    }
    return url.toString();
  } catch (err) {
    try {
      console.error('build_online_store_permalink_failed', {
        message: err?.message || String(err),
        base,
        variantNumericId: numericId,
      });
    } catch {}
    return '';
  }
}

export function buildOnlineStorePermalinkFromGid({ variantGid, quantity = 1, discountCode } = {}) {
  const numericId = idVariantGidToNumeric(variantGid);
  return buildOnlineStorePermalink({ variantNumericId: numericId, quantity, discountCode });
}

export default {
  idVariantGidToNumeric,
  buildOnlineStorePermalink,
  buildOnlineStorePermalinkFromGid,
};
