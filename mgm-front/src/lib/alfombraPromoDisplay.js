import { normalizeMaterialLabel } from './material.js';

/** Solo UI: no modifica precios enviados a Shopify. */
export const ALFOMBRA_PROMO_HEADLINE = '2x1 HASTA AGOTAR STOCK';

export function isAlfombraMaterial(material) {
  return normalizeMaterialLabel(material) === 'Alfombra';
}

export function buildAlfombraPromoDisplay(material) {
  if (!isAlfombraMaterial(material)) return null;
  return { headline: ALFOMBRA_PROMO_HEADLINE };
}
