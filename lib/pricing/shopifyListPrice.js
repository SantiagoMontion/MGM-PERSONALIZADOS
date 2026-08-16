import { applyPercentOffFloor } from './siteWideShopifyDiscount.js';
import {
  applyClassicProPriceReduction,
  isClassicOrProMaterial,
} from './classicProMaterial.js';

/** +15% y redondeo a múltiplos de $500 para lista Shopify / cliente. */
export const SHOPIFY_LIST_MARKUP_PERCENT = 15;
export const SHOPIFY_LIST_ROUND_UNIT = 500;

/**
 * Compensa subir el cupón TRANSFERENCIA de 10% → 20%:
 * lista × 1,125 para que con 20% OFF el cobro quede ≈ igual que antes con 10%.
 */
export const TRANSFERENCIA_COUPON_LIST_MARKUP_PERCENT = 12.5;
export const TRANSFERENCIA_COUPON_LIST_ROUND_UNIT = 50;

/** Ex-promo 20% OFF: queda horneado en el precio final (sin compare-at). */
export const BAKED_FORMER_SITE_WIDE_SALE_PERCENT = 20;

function isExcludedFromBakedSale(material) {
  const text = String(material ?? '').trim().toLowerCase();
  return text.includes('alfombr') || text.includes('ultra');
}

/**
 * precio_lista = redondear((base × 1,15) / 500) × 500
 * Luego, salvo Alfombra/Ultra, aplica floor(lista × 0,80) = precio que antes
 * era el de venta con 20% OFF (ej. 52500 → 42000).
 * Classic/PRO: −15% adicional horneado (sin compare-at ni badge).
 *
 * @param {number} basePrice Precio base de calculadora (antes del recargo).
 * @param {string} [material] Material; Alfombra/Ultra no reciben el ×0,80 ni −15%.
 */
export function applyShopifyListPriceMarkup(basePrice, material) {
  const base = Math.round(Number(basePrice) || 0);
  if (base <= 0) return 0;
  const markedUp = Math.round((base * (100 + SHOPIFY_LIST_MARKUP_PERCENT)) / 100);
  let list = Math.round(markedUp / SHOPIFY_LIST_ROUND_UNIT) * SHOPIFY_LIST_ROUND_UNIT;
  if (!isExcludedFromBakedSale(material)) {
    list = applyPercentOffFloor(list, BAKED_FORMER_SITE_WIDE_SALE_PERCENT);
  }
  if (isClassicOrProMaterial(material)) {
    list = applyClassicProPriceReduction(list);
  }
  // Cupón TRANSFERENCIA 20%: subir lista 12,5% (redondeo a $50).
  list = Math.round((list * (100 + TRANSFERENCIA_COUPON_LIST_MARKUP_PERCENT)) / 100);
  list = Math.round(list / TRANSFERENCIA_COUPON_LIST_ROUND_UNIT) * TRANSFERENCIA_COUPON_LIST_ROUND_UNIT;
  return list;
}
