import { getPublicStorefrontBase } from '../publicStorefront.js';
import { idVariantGidToNumeric } from '../utils/shopifyIds.js';

function clampQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

export function buildOnlineStorePermalink({ variantNumericId, quantity = 1, discountCode } = {}) {
  let numericId;
  try {
    numericId = idVariantGidToNumeric(variantNumericId);
  } catch (err) {
    try {
      console.warn('build_online_store_permalink_invalid_id', {
        message: err?.message || String(err),
        variantNumericId: variantNumericId ?? null,
      });
    } catch {}
    return '';
  }

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
  let numericId;
  try {
    numericId = idVariantGidToNumeric(variantGid);
  } catch (err) {
    try {
      console.warn('build_online_store_permalink_invalid_gid', {
        message: err?.message || String(err),
        variantGid: variantGid ?? null,
      });
    } catch {}
    return '';
  }
  return buildOnlineStorePermalink({ variantNumericId: numericId, quantity, discountCode });
}

export default {
  idVariantGidToNumeric,
  buildOnlineStorePermalink,
  buildOnlineStorePermalinkFromGid,
};
