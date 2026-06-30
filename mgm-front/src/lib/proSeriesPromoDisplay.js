import { normalizeMaterialLabel } from './material.js';
import { applyProSeriesCartDiscount } from './frontendDisplayPricing.js';

/** Solo UI: no modifica precios enviados a Shopify ni el cálculo de lista. */
export const PRO_SERIES_VISUAL_PROMO_ENABLED = false;
export const PRO_SERIES_VISUAL_DISCOUNT_PERCENT = 30;
export const PRO_SERIES_PRICE_CAPTION = '30% OFF Se aplica solo cuando agregas al carrito';
export const PRO_SERIES_STEP_THREE_NOTE = 'Se aplica solo cuando agregues tu producto al carrito';

export function isProSeriesMaterial(material) {
  return normalizeMaterialLabel(material) === 'PRO';
}

/**
 * Precio visual en carrito PRO: 30% OFF sobre lista final (+15% redondeada).
 */
export function getProSeriesVisualDisplayPrice(listPrice) {
  return applyProSeriesCartDiscount(listPrice);
}

/** @param {number} listPrice Precio de lista final (ya con +15% y redondeo). */
export function buildProSeriesPromoDisplay(material, listPrice) {
  if (!PRO_SERIES_VISUAL_PROMO_ENABLED) return null;
  if (!isProSeriesMaterial(material)) return null;

  const resolvedList = Math.round(Number(listPrice) || 0);
  const cartPrice = applyProSeriesCartDiscount(resolvedList);
  if (resolvedList <= 0 || cartPrice <= 0 || cartPrice >= resolvedList) return null;

  return {
    shopifyTransfer: resolvedList,
    compareAt: resolvedList,
    displayPrice: cartPrice,
    discountLabel: `${PRO_SERIES_VISUAL_DISCOUNT_PERCENT}% OFF`,
  };
}
