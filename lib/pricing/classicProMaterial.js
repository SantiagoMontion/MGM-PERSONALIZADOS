import { applyPercentOffFloor } from './siteWideShopifyDiscount.js';

/** Rebaja adicional Classic/PRO (sin compare-at ni badge de oferta). */
export const CLASSIC_PRO_PRICE_REDUCTION_PERCENT = 15;

export function normalizeMaterialLabel(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('glass')) return 'Glasspad';
  if (text.includes('ultra') || text.includes('poron')) return 'Ultra';
  if (text.includes('alfombr')) return 'Alfombra';
  if (text === 'pro' || text.includes('pro-control') || /\bpro\b/.test(text)) return 'PRO';
  if (text.includes('classic') || text.includes('clasic')) return 'Classic';
  return null;
}

export function isClassicOrProMaterial(material) {
  const label = normalizeMaterialLabel(material);
  return label === 'Classic' || label === 'PRO';
}

export function isExcludedFromClassicProReduction(material) {
  const label = normalizeMaterialLabel(material);
  return label === 'Ultra' || label === 'Glasspad' || label === 'Alfombra';
}

/** −15% sobre precio final (floor), sin compare-at. */
export function applyClassicProPriceReduction(price) {
  return applyPercentOffFloor(price, CLASSIC_PRO_PRICE_REDUCTION_PERCENT);
}

/**
 * Detecta material Classic/PRO para un variant de Shopify.
 * Prioridad: opción Material → título variant → tags → título producto.
 * @returns {'Classic'|'PRO'|null}
 */
export function detectClassicProMaterialForVariant({
  productTags = [],
  productTitle = '',
  variantTitle = '',
  selectedOptions = [],
} = {}) {
  for (const opt of selectedOptions) {
    if (!opt || typeof opt !== 'object') continue;
    const name = String(opt.name ?? '').trim().toLowerCase();
    const value = String(opt.value ?? '').trim();
    if (!value) continue;
    if (name.includes('material') || name === 'tipo' || name === 'serie') {
      const label = normalizeMaterialLabel(value);
      if (label === 'Classic' || label === 'PRO') return label;
      if (isExcludedFromClassicProReduction(label)) return null;
    }
  }

  const fromVariantTitle = normalizeMaterialLabel(variantTitle);
  if (fromVariantTitle === 'Classic' || fromVariantTitle === 'PRO') return fromVariantTitle;
  if (isExcludedFromClassicProReduction(fromVariantTitle)) return null;

  const tags = productTags.map((t) => String(t ?? '').trim().toLowerCase());
  if (tags.includes('material-pro')) return 'PRO';
  if (tags.includes('material-classic')) return 'Classic';
  if (
    tags.some((t) => t.includes('material-ultra')
      || t.includes('material-glass')
      || t.includes('material-alfombra'))
  ) {
    return null;
  }

  const title = String(productTitle ?? '');
  if (/glasspad/i.test(title) || /serie ultra/i.test(title) || /^alfombra\b/i.test(title)) {
    return null;
  }
  if (/\bPRO(?:\s+Form)?\s+\|\s*Custom/i.test(title)) return 'PRO';
  if (/\bClassic(?:\s+Form)?\s+\|\s*Custom/i.test(title)) return 'Classic';

  return null;
}

export default {
  CLASSIC_PRO_PRICE_REDUCTION_PERCENT,
  normalizeMaterialLabel,
  isClassicOrProMaterial,
  applyClassicProPriceReduction,
  detectClassicProMaterialForVariant,
};
