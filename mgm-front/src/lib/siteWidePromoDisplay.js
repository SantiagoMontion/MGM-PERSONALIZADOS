import { isAlfombraMaterial } from './alfombraPromoDisplay.js';
import {
  SIZE_LIMITED_PROMO_PERCENT,
  applyPercentOffFloor,
  isSizeLimitedPromoEligible,
} from '../../../lib/pricing/siteWideShopifyDiscount.js';

/** @deprecated la promo ahora es por medida (90×40 / 50×40) + Classic/PRO */
export const SITE_WIDE_VISUAL_PROMO_ENABLED = true;
export const SITE_WIDE_VISUAL_DISCOUNT_PERCENT = SIZE_LIMITED_PROMO_PERCENT;

/**
 * Precio visual con % OFF sobre lista final.
 */
export function applyVisualPercentDiscount(listPrice, percent = SITE_WIDE_VISUAL_DISCOUNT_PERCENT) {
  return applyPercentOffFloor(listPrice, percent);
}

/**
 * Promo 20% OFF solo Classic/PRO en 90×40 y 50×40.
 * UI: compareAt = lista (tachado), displayPrice = lista×0.8.
 * @param {string} material
 * @param {number} listPrice
 * @param {{ widthCm?: number, heightCm?: number }} [size]
 */
export function buildSiteWidePromoDisplay(material, listPrice, size = {}) {
  if (isAlfombraMaterial(material)) return null;
  if (!isSizeLimitedPromoEligible({
    material,
    widthCm: size.widthCm,
    heightCm: size.heightCm,
  })) {
    return null;
  }

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
