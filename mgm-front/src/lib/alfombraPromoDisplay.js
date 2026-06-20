import { normalizeMaterialLabel } from './material.js';

/** Solo UI: no modifica precios enviados a Shopify. */
export const ALFOMBRA_PROMO_HEADLINE = '2x1 HASTA AGOTAR STOCK';
export const ALFOMBRA_PROMO_HEADLINE_SHORT = '2x1';
export const ALFOMBRA_PROMO_DRAWER_FOOTER_CAPTION = 'Sumá 2 al carrito y te cobramos 1';
export const ALFOMBRA_PROMO_STEP_THREE_CAPTION = 'Agregá 2 al carrito y te cobramos 1';
export const DEFAULT_PRICE_CAPTION = 'Se suben de manera individual';

export function isAlfombraMaterial(material) {
  return normalizeMaterialLabel(material) === 'Alfombra';
}

export function buildAlfombraPromoDisplay(material, {
  short = false,
  drawerFooter = false,
  stepThree = false,
} = {}) {
  if (!isAlfombraMaterial(material)) return null;

  let headline = ALFOMBRA_PROMO_HEADLINE;
  if (short) {
    headline = ALFOMBRA_PROMO_HEADLINE_SHORT;
  } else if (drawerFooter) {
    headline = ALFOMBRA_PROMO_DRAWER_FOOTER_CAPTION;
  } else if (stepThree) {
    headline = ALFOMBRA_PROMO_STEP_THREE_CAPTION;
  }

  return {
    headline,
    drawerFooter: Boolean(drawerFooter),
    stepThree: Boolean(stepThree),
  };
}
