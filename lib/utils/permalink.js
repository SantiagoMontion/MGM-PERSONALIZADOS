function normalizeQuantity(qty) {
  const raw = Number(qty);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const floored = Math.floor(raw);
  return floored > 0 ? floored : 1;
}

export function buildOnlineStoreCartPermalink(variantIdNumeric, qty = 1, _discountCode) {
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
  const basePath = `/cart/${numericId}:${quantity}`;
  return basePath;
}

export const buildOnlineStorePermalink = buildOnlineStoreCartPermalink;

export default {
  buildOnlineStoreCartPermalink,
  buildOnlineStorePermalink,
};
