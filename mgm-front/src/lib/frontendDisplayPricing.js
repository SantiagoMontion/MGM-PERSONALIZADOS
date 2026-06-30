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

export const FRONTEND_DISPLAY_SHIPPING_CAPTION = 'Envío GRATIS a Domicilio';

/** Monto mínimo del producto para mostrar envío gratis (precio que ve el cliente). */
export const FRONTEND_FREE_SHIPPING_MINIMUM = 35000;

/** Precio de lista final (Shopify + pantalla) a partir del base de calculadora. */
export function applyFrontendDisplayPriceMarkup(basePrice) {
  return applyShopifyListPriceMarkup(basePrice);
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
  void material;
  const base = Math.round(Number(basePrice) || 0);
  if (base <= 0) return 0;
  return applyShopifyListPriceMarkup(base);
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

/**
 * Monto contra el que se evalúa envío gratis.
 * Si hay promo PRO visible, usa el precio de carrito (no la lista tachada).
 */
export function resolveFrontendShippingBasisPrice(material, basePrice, promoCartPrice = null) {
  const promoPrice = Math.round(Number(promoCartPrice) || 0);
  if (promoPrice > 0) {
    return promoPrice;
  }
  return resolveEffectiveCustomerDisplayPrice(material, basePrice);
}

/**
 * Leyenda de envío según el precio que paga el cliente (carrito PRO o lista +15%).
 * > $35.000 → envío gratis; si no, cuánto falta para llegar.
 */
export function resolveFrontendShippingCaptionForProduct(
  material,
  basePrice,
  promoCartPrice = null,
) {
  const basisPrice = resolveFrontendShippingBasisPrice(
    material,
    basePrice,
    promoCartPrice,
  );
  return resolveFrontendShippingCaption(basisPrice);
}

export function resolveFrontendShippingCaption(customerPrice) {
  const price = Math.round(Number(customerPrice) || 0);
  if (price <= 0) return null;

  if (price > FRONTEND_FREE_SHIPPING_MINIMUM) {
    return {
      qualifies: true,
      lines: [FRONTEND_DISPLAY_SHIPPING_CAPTION],
    };
  }

  const remaining = FRONTEND_FREE_SHIPPING_MINIMUM - price;
  return {
    qualifies: false,
    lines: [
      `Te falta $${formatARS(remaining)} para envío gratis,`,
      'podés sumar más productos en la tienda',
    ],
  };
}
