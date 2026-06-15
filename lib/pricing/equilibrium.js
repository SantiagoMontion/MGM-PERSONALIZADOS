/** Factor de equilibrio: absorbe IVA, Ingresos Brutos y comisiones de tarjeta en el precio de lista. */
export const LIST_PRICE_EQUILIBRIUM_FACTOR = 0.72436;

/** Serie PRO: 24% sobre precio de lista → precio neto/cobro (sin promo visible en UI). */
export const PRO_SERIES_NET_LIST_FACTOR = 0.76;

export function roundToNearestFifty(value) {
  const numeric = Number(value) || 0;
  if (numeric <= 0) return 0;
  return Math.round(numeric / 50) * 50;
}

/** Convierte el precio neto (cálculo por medidas) en precio de lista final para cliente/Shopify. */
export function applyEquilibriumListPrice(netBasePrice) {
  const net = Number(netBasePrice) || 0;
  if (net <= 0) return 0;
  return roundToNearestFifty(net / LIST_PRICE_EQUILIBRIUM_FACTOR);
}

/** Precio neto PRO = precio de lista vigente × 0,76 (redondeado a $50). */
export function applyProSeriesNetFromListPrice(listPrice) {
  const list = Number(listPrice) || 0;
  if (list <= 0) return 0;
  return roundToNearestFifty(list * PRO_SERIES_NET_LIST_FACTOR);
}

export function resolveCustomerPriceFromNetBase(netBasePrice, { isProSeries = false } = {}) {
  const listPrice = applyEquilibriumListPrice(netBasePrice);
  const customerPrice = isProSeries
    ? applyProSeriesNetFromListPrice(listPrice)
    : listPrice;
  return { listPrice, customerPrice };
}
