/** Materiales pedibles bloqueados en UI + publish (espejo del backend). */
export const OUT_OF_STOCK_MATERIALS = Object.freeze(['Glasspad', 'Ultra', 'Alfombra']);

export const MATERIAL_OUT_OF_STOCK_REASON = 'material_out_of_stock';
export const MATERIAL_OUT_OF_STOCK_MESSAGE = 'Ese material no está disponible (sin stock).';

/**
 * @param {unknown} material
 * @returns {boolean}
 */
export function isOutOfStockMaterial(material) {
  const raw = typeof material === 'string' ? material.trim() : '';
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  if (normalized.includes('glass')) return true;
  if (normalized === 'ultra' || normalized.includes('serie ultra') || normalized.includes('poron')) {
    return true;
  }
  if (normalized.includes('alfombr')) return true;
  return false;
}

/**
 * @param {unknown} productType
 * @returns {boolean}
 */
export function isOutOfStockProductType(productType) {
  const raw = typeof productType === 'string' ? productType.trim().toLowerCase() : '';
  if (!raw) return false;
  if (raw.includes('glass')) return true;
  if (raw.includes('alfombr')) return true;
  if (raw === 'ultra' || raw.includes('ultra')) return true;
  return false;
}
