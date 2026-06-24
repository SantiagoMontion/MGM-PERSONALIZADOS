/** Factor de equilibrio: absorbe IVA, Ingresos Brutos y comisiones de tarjeta en el precio de lista. */
export const LIST_PRICE_EQUILIBRIUM_FACTOR = 0.72436;

/** Serie PRO: 24% sobre precio de lista → precio neto/cobro (sin promo visible en UI). */
export const PRO_SERIES_NET_LIST_FACTOR = 0.76;

/** Precio de lista final fijo para Serie Ultra (incluye equilibrio comercial acordado). */
export const ULTRA_FINAL_LIST_PRICE = 75000;

export function roundToNearestFifty(value) {
  const numeric = Number(value) || 0;
  if (numeric <= 0) return 0;
  return Math.round(numeric / 50) * 50;
}

/** Redondeo hacia abajo al múltiplo de $50 (alineado con Shopify). */
export function roundDownToNearestFifty(value) {
  const numeric = Number(value) || 0;
  if (numeric <= 0) return 0;
  return Math.floor(numeric / 50) * 50;
}

/** Convierte el precio neto (cálculo por medidas) en precio de lista final para cliente/Shopify. */
export function applyEquilibriumListPrice(netBasePrice, { roundDown = true } = {}) {
  const net = Number(netBasePrice) || 0;
  if (net <= 0) return 0;
  const raw = net / LIST_PRICE_EQUILIBRIUM_FACTOR;
  return roundDown ? roundDownToNearestFifty(raw) : roundToNearestFifty(raw);
}

/** Precio neto PRO = precio de lista vigente × 0,76 (redondeo al $50 más cercano, como Shopify). */
export function applyProSeriesNetFromListPrice(listPrice) {
  const list = Number(listPrice) || 0;
  if (list <= 0) return 0;
  return roundToNearestFifty(list * PRO_SERIES_NET_LIST_FACTOR);
}

export function resolveCustomerPriceFromNetBase(netBasePrice, { isProSeries = false } = {}) {
  // PRO: lista con redondeo matemático y cobro = lista × 0,76 al $50 más cercano (Shopify).
  // Classic / Alfombra: lista final con redondeo hacia abajo a $50.
  const listPrice = applyEquilibriumListPrice(netBasePrice, { roundDown: !isProSeries });
  const customerPrice = isProSeries
    ? applyProSeriesNetFromListPrice(listPrice)
    : listPrice;
  return { listPrice, customerPrice };
}
