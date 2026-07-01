import { applyShopifyListPriceMarkup } from './shopifyListPrice.js';

/** Medidas chicas: ambos lados ≤ este valor (cm). */
export const PRO_SMALL_SIZE_MAX_CM = 30;

/** PRO debe costar al menos este monto más que Classic (precio final con +15% / redondeo $500). */
export const PRO_SMALL_SIZE_MIN_PREMIUM_OVER_CLASSIC = 1500;

export function isProSmallSize(widthCm, heightCm) {
  const w = Number(widthCm) || 0;
  const h = Number(heightCm) || 0;
  if (w <= 0 || h <= 0) return false;
  return w <= PRO_SMALL_SIZE_MAX_CM && h <= PRO_SMALL_SIZE_MAX_CM;
}

/** Mínimo transfer (pre +15%) para alcanzar un precio Shopify objetivo. */
export function resolveMinTransferForMinShopifyPrice(minShopifyPrice) {
  const target = Math.round(Number(minShopifyPrice) || 0);
  if (target <= 0) return 0;

  let lo = 0;
  let hi = Math.max(target * 2, 5000);
  while (applyShopifyListPriceMarkup(hi) < target) {
    hi *= 2;
    if (hi > 500000) break;
  }

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (applyShopifyListPriceMarkup(mid) >= target) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * Ajusta PRO en medidas chicas: precio final ≥ Classic + premium.
 * @param {object} proResult Resultado de calculadora PRO.
 * @param {number} widthCm
 * @param {number} heightCm
 * @param {function} getClassicTransfer (w, h) => transfer Classic sin premium PRO.
 */
export function applyProSmallSizePremiumOverClassic(proResult, widthCm, heightCm, getClassicTransfer) {
  if (!proResult?.valid || proResult.mode !== 'Pro') return proResult;
  if (!isProSmallSize(widthCm, heightCm)) return proResult;

  const classicTransfer = getClassicTransfer(widthCm, heightCm);
  if (!(classicTransfer > 0)) return proResult;

  const classicShopify = applyShopifyListPriceMarkup(classicTransfer);
  const minProShopify = classicShopify + PRO_SMALL_SIZE_MIN_PREMIUM_OVER_CLASSIC;
  const proShopify = applyShopifyListPriceMarkup(proResult.transfer);

  if (proShopify >= minProShopify) return proResult;

  const minTransfer = resolveMinTransferForMinShopifyPrice(minProShopify);
  return {
    ...proResult,
    transfer: minTransfer,
    normal: minTransfer,
    price: minTransfer,
  };
}
