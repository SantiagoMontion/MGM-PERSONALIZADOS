import { formatARS } from './pricing.js';

/** Recargo visual solo en UI; no modifica `priceTransfer` / Shopify. */
export const FRONTEND_DISPLAY_PRICE_MARKUP = 1.15;

export const FRONTEND_DISPLAY_SHIPPING_CAPTION = 'Envío GRATIS a Domicilio';

export function applyFrontendDisplayPriceMarkup(transferPrice) {
  const base = Math.round(Number(transferPrice) || 0);
  if (base <= 0) return 0;
  return Math.round(base * FRONTEND_DISPLAY_PRICE_MARKUP);
}

export function formatFrontendDisplayPriceLabel(transferPrice) {
  const displayPrice = applyFrontendDisplayPriceMarkup(transferPrice);
  return displayPrice > 0 ? `$${formatARS(displayPrice)}` : '—';
}
