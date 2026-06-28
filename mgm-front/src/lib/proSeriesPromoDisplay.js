import { normalizeMaterialLabel } from './material.js';
import {
  applyProSeriesCartDiscount,
  resolveProSeriesDisplayPricing,
} from './frontendDisplayPricing.js';

/** Solo UI: no modifica precios enviados a Shopify ni el cálculo de lista. */
export const PRO_SERIES_VISUAL_PROMO_ENABLED = false;
export const PRO_SERIES_VISUAL_DISCOUNT_PERCENT = 30;
export const PRO_SERIES_PRICE_CAPTION = '30% OFF Se aplica solo cuando agregas al carrito';
export const PRO_SERIES_STEP_THREE_NOTE = 'Se aplica solo cuando agregues tu producto al carrito';

export function isProSeriesMaterial(material) {
  return normalizeMaterialLabel(material) === 'PRO';
}

/**
 * Precio visual en carrito PRO: 30% OFF sobre lista con +15%.
 * `listPrice` debe ser el monto ya marcado (no el transfer de Shopify).
 */
export function getProSeriesVisualDisplayPrice(listPrice) {
  return applyProSeriesCartDiscount(listPrice);
}

export function buildProSeriesPromoDisplay(material, shopifyTransferPrice) {
  if (!PRO_SERIES_VISUAL_PROMO_ENABLED) return null;
  if (!isProSeriesMaterial(material)) return null;

  const { shopify, listPrice, cartPrice } = resolveProSeriesDisplayPricing(shopifyTransferPrice);
  if (shopify <= 0 || listPrice <= 0 || cartPrice <= 0 || cartPrice >= listPrice) return null;

  return {
    shopifyTransfer: shopify,
    compareAt: listPrice,
    displayPrice: cartPrice,
    discountLabel: `${PRO_SERIES_VISUAL_DISCOUNT_PERCENT}% OFF`,
  };
}
