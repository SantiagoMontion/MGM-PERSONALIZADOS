/** Promo 20% OFF: solo Classic/PRO en 90x40 y 50x40.
 * Precio de venta = floor(lista x 0.80); compare-at = lista (tachado).
 */

export const SITE_WIDE_SHOPIFY_DISCOUNT_PERCENT = 20;
/** @deprecated usar SIZE_LIMITED_PROMO_ENABLED */
export const SITE_WIDE_SHOPIFY_DISCOUNT_ENABLED = true;

export const SIZE_LIMITED_PROMO_ENABLED = true;
export const SIZE_LIMITED_PROMO_PERCENT = 20;
export const SIZE_LIMITED_PROMO_SIZES = [
  { width: 90, height: 40 },
  { width: 50, height: 40 },
];

/** Precios de venta / promo visibles: múltiplos de $100 (ej. 21488 → 21500). */
export const SALE_PRICE_ROUND_UNIT = 100;

export function roundToSalePriceUnit(value, unit = SALE_PRICE_ROUND_UNIT) {
  const n = Math.round(Number(value) || 0);
  const step = Math.round(Number(unit) || 0);
  if (n <= 0 || step <= 0) return 0;
  return Math.round(n / step) * step;
}

/**
 * floor(lista x (100 - percent) / 100) — sin redondeo comercial.
 * @param {number} listPrice
 * @param {number} [percent]
 */
export function applyPercentOffFloor(listPrice, percent = SIZE_LIMITED_PROMO_PERCENT) {
  const list = Math.round(Number(listPrice) || 0);
  const off = Math.round(Number(percent) || 0);
  if (list <= 0 || off <= 0 || off >= 100) return 0;
  return Math.floor((list * (100 - off)) / 100);
}

/** % OFF de cara al cliente / Shopify sale: floor + redondeo a $100. */
export function applyPercentOffSalePrice(listPrice, percent = SIZE_LIMITED_PROMO_PERCENT) {
  return roundToSalePriceUnit(applyPercentOffFloor(listPrice, percent));
}

function normalizeMaterialForPromo(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('glass') || text.includes('ultra') || text.includes('alfombr') || text.includes('poron')) {
    return null;
  }
  if (text === 'pro' || text.includes('pro-control') || /\bpro\b/.test(text)) return 'PRO';
  if (text.includes('classic') || text.includes('clasic')) return 'Classic';
  return null;
}

export function normalizePromoSizeCm(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Acepta 90x40 / 40x90 y 50x40 / 40x50.
 */
export function isSizeLimitedPromoSize(widthCm, heightCm) {
  const w = normalizePromoSizeCm(widthCm);
  const h = normalizePromoSizeCm(heightCm);
  if (w == null || h == null) return false;
  return SIZE_LIMITED_PROMO_SIZES.some(
    ({ width, height }) => (w === width && h === height) || (w === height && h === width),
  );
}

export function isSizeLimitedPromoMaterial(material) {
  const label = normalizeMaterialForPromo(material);
  return label === 'Classic' || label === 'PRO';
}

/**
 * @param {object} params
 * @param {string} [params.material]
 * @param {number|string} [params.widthCm]
 * @param {number|string} [params.heightCm]
 */
export function isSizeLimitedPromoEligible({ material, widthCm, heightCm } = {}) {
  if (!SIZE_LIMITED_PROMO_ENABLED) return false;
  if (!isSizeLimitedPromoMaterial(material)) return false;
  return isSizeLimitedPromoSize(widthCm, heightCm);
}

/**
 * Extrae primera medida WxH de un titulo / handle.
 * @returns {{ width: number, height: number } | null}
 */
export function extractSizeCmFromText(text) {
  const raw = String(text ?? '');
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
  if (!match) return null;
  const width = normalizePromoSizeCm(String(match[1]).replace(',', '.'));
  const height = normalizePromoSizeCm(String(match[2]).replace(',', '.'));
  if (width == null || height == null) return null;
  return { width, height };
}

/**
 * Resuelve precio de venta + compare-at para Shopify / UI.
 * Elegible: price = lista x 0.80, compareAt = lista.
 * Resto: price = lista, sin compare-at.
 *
 * @param {object} params
 * @param {number} params.listPrice Precio de lista final
 * @param {string} [params.material]
 * @param {number|string} [params.widthCm]
 * @param {number|string} [params.heightCm]
 * @returns {{ price: number, compareAtPrice: number | null, discountApplied: boolean }}
 */
export function resolveShopifySalePricing({
  listPrice,
  material,
  widthCm,
  heightCm,
} = {}) {
  const list = roundToSalePriceUnit(Math.round(Number(listPrice) || 0));
  if (list <= 0) {
    return { price: 0, compareAtPrice: null, discountApplied: false };
  }

  if (!isSizeLimitedPromoEligible({ material, widthCm, heightCm })) {
    return { price: list, compareAtPrice: null, discountApplied: false };
  }

  const salePrice = applyPercentOffSalePrice(list, SIZE_LIMITED_PROMO_PERCENT);
  if (salePrice <= 0 || salePrice >= list) {
    return { price: list, compareAtPrice: null, discountApplied: false };
  }

  return {
    price: salePrice,
    compareAtPrice: list,
    discountApplied: true,
  };
}
