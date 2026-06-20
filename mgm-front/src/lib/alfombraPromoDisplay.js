import { normalizeMaterialLabel } from './material.js';

/** Solo UI: no modifica precios enviados a Shopify. */
export const ALFOMBRA_PROMO_HEADLINE = '2x1 HASTA AGOTAR STOCK';
export const ALFOMBRA_PROMO_HEADLINE_SHORT = '2x1';
export const DEFAULT_PRICE_CAPTION = 'Se suben de manera individual';

export function isAlfombraMaterial(material) {
  return normalizeMaterialLabel(material) === 'Alfombra';
}

export function buildAlfombraPromoDisplay(material, { short = false } = {}) {
  if (!isAlfombraMaterial(material)) return null;
  return {
    headline: short ? ALFOMBRA_PROMO_HEADLINE_SHORT : ALFOMBRA_PROMO_HEADLINE,
  };
}
