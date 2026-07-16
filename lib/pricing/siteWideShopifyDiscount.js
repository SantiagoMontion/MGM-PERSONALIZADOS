/** Promo 20% OFF en Shopify (precio de venta) + lista como compare-at. Alfombra y Ultra excluidas. */
export const SITE_WIDE_SHOPIFY_DISCOUNT_PERCENT = 20;
export const SITE_WIDE_SHOPIFY_DISCOUNT_ENABLED = true;

/**
 * floor(lista × (100 - percent) / 100)
 * @param {number} listPrice
 * @param {number} [percent]
 */
export function applyPercentOffFloor(listPrice, percent = SITE_WIDE_SHOPIFY_DISCOUNT_PERCENT) {
  const list = Math.round(Number(listPrice) || 0);
  const off = Math.round(Number(percent) || 0);
  if (list <= 0 || off <= 0 || off >= 100) return 0;
  return Math.floor((list * (100 - off)) / 100);
}

function isAlfombraMaterialLabel(material) {
  const text = String(material ?? '').trim().toLowerCase();
  return text.includes('alfombr');
}

function isUltraMaterialLabel(material) {
  const text = String(material ?? '').trim().toLowerCase();
  return text.includes('ultra');
}

/**
 * Resuelve precio de venta + compare-at para Shopify.
 * - Alfombra / Ultra / promo off: price = lista, sin compare-at
 * - Resto: price = lista × 0.80, compareAt = lista (tachado en tienda)
 *
 * @param {object} params
 * @param {number} params.listPrice Precio de lista final (+15% redondeado)
 * @param {string} [params.material]
 * @returns {{ price: number, compareAtPrice: number | null, discountApplied: boolean }}
 */
export function resolveShopifySalePricing({ listPrice, material } = {}) {
  const list = Math.round(Number(listPrice) || 0);
  if (list <= 0) {
    return { price: 0, compareAtPrice: null, discountApplied: false };
  }

  if (
    !SITE_WIDE_SHOPIFY_DISCOUNT_ENABLED
    || isAlfombraMaterialLabel(material)
    || isUltraMaterialLabel(material)
  ) {
    return { price: list, compareAtPrice: null, discountApplied: false };
  }

  const salePrice = applyPercentOffFloor(list, SITE_WIDE_SHOPIFY_DISCOUNT_PERCENT);
  if (salePrice <= 0 || salePrice >= list) {
    return { price: list, compareAtPrice: null, discountApplied: false };
  }

  return {
    price: salePrice,
    compareAtPrice: list,
    discountApplied: true,
  };
}
