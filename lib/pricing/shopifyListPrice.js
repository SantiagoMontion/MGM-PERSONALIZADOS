/** +15% y redondeo a múltiplos de $500 para lista Shopify / cliente. */
export const SHOPIFY_LIST_MARKUP_PERCENT = 15;
export const SHOPIFY_LIST_ROUND_UNIT = 500;

/**
 * precio_nuevo = redondear((precio_original × 1,15) / 500) × 500
 * @param {number} basePrice Precio base de calculadora (antes del recargo).
 */
export function applyShopifyListPriceMarkup(basePrice) {
  const base = Math.round(Number(basePrice) || 0);
  if (base <= 0) return 0;
  const markedUp = Math.round((base * (100 + SHOPIFY_LIST_MARKUP_PERCENT)) / 100);
  return Math.round(markedUp / SHOPIFY_LIST_ROUND_UNIT) * SHOPIFY_LIST_ROUND_UNIT;
}
