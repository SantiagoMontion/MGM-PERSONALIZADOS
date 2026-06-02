import { normalizeMaterialLabel } from './material.js';

/** Solo UI: no modifica precios enviados a Shopify ni el cálculo de transferencia. */
export const PRO_SERIES_VISUAL_DISCOUNT_PERCENT = 30;

export function isProSeriesMaterial(material) {
  return normalizeMaterialLabel(material) === 'PRO';
}

/**
 * Precio que se muestra en pantalla con 30% OFF visual.
 * El cobro real (transferencia / Shopify) sigue siendo `transferPrice`.
 * Ej.: transfer 43.500 → se muestra 30.450.
 */
export function getProSeriesVisualDisplayPrice(transferPrice) {
  const transfer = Math.round(Number(transferPrice) || 0);
  if (transfer <= 0) return 0;
  const factor = 1 - PRO_SERIES_VISUAL_DISCOUNT_PERCENT / 100;
  return Math.round(transfer * factor);
}

export function buildProSeriesPromoDisplay(material, transferPrice) {
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
