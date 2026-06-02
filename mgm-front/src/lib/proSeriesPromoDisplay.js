import { normalizeMaterialLabel } from './material.js';

/** Solo UI: no modifica precios enviados a Shopify ni el cálculo de transferencia. */
export const PRO_SERIES_VISUAL_DISCOUNT_PERCENT = 30;

export function isProSeriesMaterial(material) {
  return normalizeMaterialLabel(material) === 'PRO';
}

/** Precio "antes" tachado para mostrar 30% OFF visual; el cobro real sigue siendo transferPrice. */
export function getProSeriesVisualComparePrice(transferPrice) {
  const transfer = Math.round(Number(transferPrice) || 0);
  if (transfer <= 0) return 0;
  const factor = 1 - PRO_SERIES_VISUAL_DISCOUNT_PERCENT / 100;
  if (factor <= 0) return transfer;
  return Math.round(transfer / factor);
}

export function buildProSeriesPromoDisplay(material, transferPrice) {
  if (!isProSeriesMaterial(material)) return null;
  const transfer = Math.round(Number(transferPrice) || 0);
  if (transfer <= 0) return null;
  const compareAt = getProSeriesVisualComparePrice(transfer);
  if (compareAt <= transfer) return null;
  return {
    transfer,
    compareAt,
    discountLabel: `${PRO_SERIES_VISUAL_DISCOUNT_PERCENT}% OFF`,
  };
}
