import { formatARS } from './pricing.js';
import {
  SHOPIFY_LIST_MARKUP_PERCENT as FRONTEND_DISPLAY_PRICE_MARKUP_PERCENT,
  SHOPIFY_LIST_ROUND_UNIT as FRONTEND_DISPLAY_PRICE_ROUND_UNIT,
  applyShopifyListPriceMarkup,
} from '../../../lib/pricing/shopifyListPrice.js';

/** Recargo de lista (+15%) y redondeo a $500; mismo monto en UI y Shopify. */
export { FRONTEND_DISPLAY_PRICE_MARKUP_PERCENT };
export const FRONTEND_DISPLAY_PRICE_MARKUP = 1.15;
export { FRONTEND_DISPLAY_PRICE_ROUND_UNIT };

/** Descuento de carrito PRO (solo visual; Shopify lo aplica al agregar). */
export const PRO_SERIES_CART_DISCOUNT_PERCENT = 30;

/** Precio de lista final (Shopify + pantalla) a partir del base de calculadora. */
export function applyFrontendDisplayPriceMarkup(basePrice, material) {
  return applyShopifyListPriceMarkup(basePrice, material);
}

/** Alias explícito para payloads / checkout. */
export const resolveShopifyListPrice = applyShopifyListPriceMarkup;

/**
 * Precio en carrito PRO: 30% OFF sobre la lista con recargo (+15%).
 * Coincide con Shopify: floor(lista × 0,70).
 */
export function applyProSeriesCartDiscount(listPrice) {
  const list = Math.round(Number(listPrice) || 0);
  if (list <= 0) return 0;
  return Math.floor((list * (100 - PRO_SERIES_CART_DISCOUNT_PERCENT)) / 100);
}

/**
 * Cadena completa PRO para UI:
 * base → ×1,15 redondeado lista → ×0,70 carrito.
 */
export function resolveProSeriesDisplayPricing(basePrice) {
  const base = Math.round(Number(basePrice) || 0);
  if (base <= 0) {
    return { shopify: 0, listPrice: 0, cartPrice: 0 };
  }
  const listPrice = applyShopifyListPriceMarkup(base);
  const cartPrice = applyProSeriesCartDiscount(listPrice);
  return { shopify: base, listPrice, cartPrice };
}

/** Precio que ve el cliente y se publica en Shopify. */
export function resolveEffectiveCustomerDisplayPrice(material, basePrice) {
  const base = Math.round(Number(basePrice) || 0);
  if (base <= 0) return 0;
  return applyShopifyListPriceMarkup(base, material);
}

/** Formatea lista final; acepta base de calculadora o precio ya resuelto si `alreadyResolved`. */
export function formatFrontendDisplayPriceLabel(price, material = null, { alreadyResolved = false } = {}) {
  const resolved = alreadyResolved
    ? Math.round(Number(price) || 0)
    : (material
      ? resolveEffectiveCustomerDisplayPrice(material, price)
      : applyShopifyListPriceMarkup(price));
  return resolved > 0 ? `$${formatARS(resolved)}` : '—';
}
