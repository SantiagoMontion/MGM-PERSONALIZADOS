import { isAlfombraMaterial } from './alfombraPromoDisplay.js';

/** Promo visual 20% OFF alineada con Shopify (precio venta = lista×0.8). */
export const SITE_WIDE_VISUAL_PROMO_ENABLED = true;
export const SITE_WIDE_VISUAL_DISCOUNT_PERCENT = 20;

/**
 * Precio visual con % OFF sobre lista final (+15% redondeada).
 * Coincide con floor(lista × (100 - percent) / 100) y con resolveShopifySalePricing.
 */
export function applyVisualPercentDiscount(listPrice, percent = SITE_WIDE_VISUAL_DISCOUNT_PERCENT) {
  const list = Math.round(Number(listPrice) || 0);
  const off = Math.round(Number(percent) || 0);
  if (list <= 0 || off <= 0 || off >= 100) return 0;
  return Math.floor((list * (100 - off)) / 100);
}

/**
 * Promo 20% OFF para todos los materiales excepto Alfombra (que mantiene 2x1).
 * En UI: compareAt = lista (tachado), displayPrice = lista×0.8.
 * En Shopify: price = displayPrice, compareAtPrice = compareAt.
 * @param {string} material
 * @param {number} listPrice Precio de lista final (ya con +15% y redondeo).
 */
export function buildSiteWidePromoDisplay(material, listPrice) {
  if (!SITE_WIDE_VISUAL_PROMO_ENABLED) return null;
  if (isAlfombraMaterial(material)) return null;

  const resolvedList = Math.round(Number(listPrice) || 0);
  const displayPrice = applyVisualPercentDiscount(resolvedList, SITE_WIDE_VISUAL_DISCOUNT_PERCENT);
  if (resolvedList <= 0 || displayPrice <= 0 || displayPrice >= resolvedList) return null;

  return {
    shopifyTransfer: resolvedList,
    compareAt: resolvedList,
    displayPrice,
    discountLabel: `${SITE_WIDE_VISUAL_DISCOUNT_PERCENT}% OFF`,
  };
}
