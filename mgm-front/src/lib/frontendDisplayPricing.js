import { formatARS } from './pricing.js';

/** Recargo visual solo en UI; no modifica `priceTransfer` / Shopify. */
export const FRONTEND_DISPLAY_PRICE_MARKUP_PERCENT = 15;
export const FRONTEND_DISPLAY_PRICE_MARKUP = 1.15;
/** Redondeo de lista: múltiplos de $500 tras aplicar +15%. */
export const FRONTEND_DISPLAY_PRICE_ROUND_UNIT = 500;

/** Descuento de carrito PRO (solo visual; Shopify lo aplica al agregar). */
export const PRO_SERIES_CART_DISCOUNT_PERCENT = 30;

export const FRONTEND_DISPLAY_SHIPPING_CAPTION = 'Envío GRATIS a Domicilio';

/** Monto mínimo del producto para mostrar envío gratis (precio que ve el cliente). */
export const FRONTEND_FREE_SHIPPING_MINIMUM = 35000;

/**
 * Lista con +15% sobre el precio que va a Shopify, redondeada al múltiplo de $500 más cercano:
 * redondear((precio_original × 1,15) / 500) × 500
 */
export function applyFrontendDisplayPriceMarkup(shopifyTransferPrice) {
  const base = Math.round(Number(shopifyTransferPrice) || 0);
  if (base <= 0) return 0;
  const markedUp = Math.round((base * (100 + FRONTEND_DISPLAY_PRICE_MARKUP_PERCENT)) / 100);
  const unit = FRONTEND_DISPLAY_PRICE_ROUND_UNIT;
  return Math.round(markedUp / unit) * unit;
}

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
 * shopify → ×1,15 lista → ×0,70 carrito.
 */
export function resolveProSeriesDisplayPricing(shopifyTransferPrice) {
  const shopify = Math.round(Number(shopifyTransferPrice) || 0);
  if (shopify <= 0) {
    return { shopify: 0, listPrice: 0, cartPrice: 0 };
  }
  const listPrice = applyFrontendDisplayPriceMarkup(shopify);
  const cartPrice = applyProSeriesCartDiscount(listPrice);
  return { shopify, listPrice, cartPrice };
}

/** Precio que ve el cliente en pantalla: lista +15% (todos los materiales). */
export function resolveEffectiveCustomerDisplayPrice(material, shopifyTransferPrice) {
  const shopify = Math.round(Number(shopifyTransferPrice) || 0);
  if (shopify <= 0) return 0;
  return applyFrontendDisplayPriceMarkup(shopify);
}

export function formatFrontendDisplayPriceLabel(transferPrice, material = null) {
  const displayPrice = material
    ? resolveEffectiveCustomerDisplayPrice(material, transferPrice)
    : applyFrontendDisplayPriceMarkup(transferPrice);
  return displayPrice > 0 ? `$${formatARS(displayPrice)}` : '—';
}

/**
 * Monto contra el que se evalúa envío gratis.
 * Si hay promo PRO visible, usa el precio de carrito (no la lista tachada).
 */
export function resolveFrontendShippingBasisPrice(material, shopifyTransferPrice, promoCartPrice = null) {
  const promoPrice = Math.round(Number(promoCartPrice) || 0);
  if (promoPrice > 0) {
    return promoPrice;
  }
  return resolveEffectiveCustomerDisplayPrice(material, shopifyTransferPrice);
}

/**
 * Leyenda de envío según el precio que paga el cliente (carrito PRO o lista +15%).
 * > $35.000 → envío gratis; si no, cuánto falta para llegar.
 */
export function resolveFrontendShippingCaptionForProduct(
  material,
  shopifyTransferPrice,
  promoCartPrice = null,
) {
  const basisPrice = resolveFrontendShippingBasisPrice(
    material,
    shopifyTransferPrice,
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
