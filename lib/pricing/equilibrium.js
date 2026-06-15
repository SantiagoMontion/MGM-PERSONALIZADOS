/** Factor de equilibrio: absorbe IVA, Ingresos Brutos y comisiones de tarjeta en el precio de lista. */
export const LIST_PRICE_EQUILIBRIUM_FACTOR = 0.72436;

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
