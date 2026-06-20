import { normalizeMaterialLabel } from './material.js';
import { roundDownToNearestFifty } from '../../../lib/pricing/equilibrium.js';

/** Solo UI: no modifica precios enviados a Shopify ni el cálculo de lista. */
export const PRO_SERIES_VISUAL_PROMO_ENABLED = true;
export const PRO_SERIES_VISUAL_DISCOUNT_PERCENT = 30;
export const PRO_SERIES_PRICE_CAPTION = '30% OFF Se aplica solo cuando agregas al carrito';
export const PRO_SERIES_STEP_THREE_NOTE = 'Se aplica solo cuando agregues tu producto al carrito';

export function isProSeriesMaterial(material) {
  return normalizeMaterialLabel(material) === 'PRO';
}

/**
 * Precio visual con 30% OFF (solo pantalla).
 * El precio real de cobro / Shopify sigue siendo `transferPrice`.
 */
export function getProSeriesVisualDisplayPrice(transferPrice) {
  const transfer = Math.round(Number(transferPrice) || 0);
  if (transfer <= 0) return 0;
  const factor = 1 - PRO_SERIES_VISUAL_DISCOUNT_PERCENT / 100;
  return roundDownToNearestFifty(transfer * factor);
}

export function buildProSeriesPromoDisplay(material, transferPrice) {
  if (!PRO_SERIES_VISUAL_PROMO_ENABLED) return null;
  if (!isProSeriesMaterial(material)) return null;
  const actualTransfer = Math.round(Number(transferPrice) || 0);
  if (actualTransfer <= 0) return null;
  const displayPrice = getProSeriesVisualDisplayPrice(actualTransfer);
  if (displayPrice <= 0 || displayPrice >= actualTransfer) return null;
  return {
    actualTransfer,
    compareAt: actualTransfer,
    displayPrice,
    discountLabel: `${PRO_SERIES_VISUAL_DISCOUNT_PERCENT}% OFF`,
  };
}
