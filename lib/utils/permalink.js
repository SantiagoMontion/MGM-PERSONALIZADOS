const DISCOUNT_CLEANUP_REGEX = /[^A-Za-z0-9-_]/g;

function normalizeQuantity(qty) {
  const raw = Number(qty);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const floored = Math.floor(raw);
  return floored > 0 ? floored : 1;
}

function sanitizeDiscountCode(code) {
  if (typeof code !== 'string') return '';
  const trimmed = code.trim();
  if (!trimmed) return '';
  return trimmed.replace(DISCOUNT_CLEANUP_REGEX, '');
}

export function buildOnlineStoreCartPermalink(variantIdNumeric, qty = 1, discountCode) {
  let numericId = '';
  if (typeof variantIdNumeric === 'string') {
    numericId = variantIdNumeric.trim();
  } else if (typeof variantIdNumeric === 'number' && Number.isFinite(variantIdNumeric)) {
    numericId = String(Math.floor(variantIdNumeric));
  } else if (typeof variantIdNumeric === 'bigint') {
    numericId = variantIdNumeric >= 0n ? variantIdNumeric.toString() : '';
  }
  if (!/^\d+$/.test(numericId)) {
    return '';
  }

  const quantity = normalizeQuantity(qty);
  const params = new URLSearchParams();
  const sanitizedCode = sanitizeDiscountCode(discountCode);
  if (sanitizedCode) {
    params.set('discount', sanitizedCode);
  }

  const query = params.toString();
  const basePath = `/cart/${numericId}:${quantity}`;
  return query ? `${basePath}?${query}` : basePath;
}

export const buildOnlineStorePermalink = buildOnlineStoreCartPermalink;

export default {
  buildOnlineStoreCartPermalink,
  buildOnlineStorePermalink,
};
