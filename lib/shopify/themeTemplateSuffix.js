/**
 * Plantillas de tema Shopify por serie (templateSuffix).
 * Si no hay señal → null (producto predeterminado).
 */

export const THEME_TEMPLATE_SUFFIX = Object.freeze({
  PRO: 'serie-pro',
  Classic: 'serie-classic',
  Ultra: 'serie-ultra',
  Glasspad: 'serie-g-glasspad',
  Alfombra: 'alfombras',
});

/**
 * Detecta serie desde un texto libre (título, opción, tag).
 * @returns {'PRO'|'Classic'|'Ultra'|'Glasspad'|'Alfombra'|null}
 */
export function detectSeriesFromText(raw) {
  const text = String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  if (/\bglasspad\b/.test(lower) || /\bglass\b/.test(lower)) return 'Glasspad';
  if (/\balfombr/.test(lower)) return 'Alfombra';
  if (/\bultra\b/.test(lower) || /\bporon\b/.test(lower) || /serie\s+ultra/.test(lower)) {
    return 'Ultra';
  }
  if (/\bpro\b/.test(lower) || /\bpro-control\b/.test(lower)) return 'PRO';
  if (/\bclassic\b/.test(lower) || /\bclasic\b/.test(lower)) return 'Classic';

  return null;
}

/** Alias: detectar desde título de producto. */
export function detectSeriesFromProductTitle(title) {
  return detectSeriesFromText(title);
}

/**
 * @param {string} title
 * @returns {string|null} templateSuffix o null = plantilla producto predeterminada
 */
export function resolveThemeTemplateSuffixFromTitle(title) {
  const series = detectSeriesFromText(title);
  if (!series) return null;
  return THEME_TEMPLATE_SUFFIX[series] ?? null;
}

/**
 * Fallback cuando el material ya está resuelto (publish).
 * @param {string} materialLabel
 * @returns {string|null}
 */
export function resolveThemeTemplateSuffixFromMaterial(materialLabel) {
  return resolveThemeTemplateSuffixFromTitle(materialLabel);
}

/**
 * Si el título no indica serie, mira variantes (opción Material / título).
 * Si hay series mixtas (p.ej. Classic+PRO) → null (predeterminado).
 *
 * @param {{ title?: string, variants?: Array<{ title?: string, selectedOptions?: Array<{ name?: string, value?: string }> }> }} product
 * @returns {string|null}
 */
export function resolveThemeTemplateSuffixFromProduct(product = {}) {
  const fromTitle = resolveThemeTemplateSuffixFromTitle(product?.title);
  if (fromTitle) return fromTitle;

  const seriesSet = new Set();
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  for (const variant of variants) {
    const options = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
    for (const opt of options) {
      const name = String(opt?.name ?? '').trim().toLowerCase();
      const value = String(opt?.value ?? '').trim();
      if (!value) continue;
      if (name.includes('material') || name === 'tipo' || name === 'serie') {
        const series = detectSeriesFromText(value);
        if (series) seriesSet.add(series);
      }
    }
    const fromVariantTitle = detectSeriesFromText(variant?.title);
    if (fromVariantTitle) seriesSet.add(fromVariantTitle);
  }

  if (seriesSet.size === 1) {
    const only = [...seriesSet][0];
    return THEME_TEMPLATE_SUFFIX[only] ?? null;
  }
  // mixtas o sin señal → producto predeterminado
  return null;
}

/**
 * Preferí material (publish); si no hay señal, título.
 */
export function resolveThemeTemplateSuffix({ title, material } = {}) {
  return resolveThemeTemplateSuffixFromMaterial(material)
    ?? resolveThemeTemplateSuffixFromTitle(title)
    ?? null;
}

export default {
  THEME_TEMPLATE_SUFFIX,
  detectSeriesFromText,
  detectSeriesFromProductTitle,
  resolveThemeTemplateSuffixFromTitle,
  resolveThemeTemplateSuffixFromMaterial,
  resolveThemeTemplateSuffixFromProduct,
  resolveThemeTemplateSuffix,
};
