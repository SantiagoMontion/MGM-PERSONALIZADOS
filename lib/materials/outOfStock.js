/**
 * Materiales visibles en el editor pero no pedibles (mismo set que la UI).
 * El API debe rechazarlos aunque alguien arme el request a mano.
 */
export const OUT_OF_STOCK_MATERIALS = Object.freeze(['Glasspad', 'Ultra', 'Alfombra']);

export const MATERIAL_OUT_OF_STOCK_REASON = 'material_out_of_stock';

/**
 * @param {unknown} material
 * @returns {string|null} Label canónico si está sin stock; si no, null.
 */
export function resolveOutOfStockMaterial(material) {
  const raw = typeof material === 'string' ? material.trim() : '';
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized.includes('glass')) return 'Glasspad';
  if (normalized === 'ultra' || normalized.includes('serie ultra') || normalized.includes('poron')) {
    return 'Ultra';
  }
  if (normalized.includes('alfombr')) return 'Alfombra';
  return null;
}

/**
 * @param {unknown} productType
 * @returns {string|null}
 */
export function resolveOutOfStockProductType(productType) {
  const raw = typeof productType === 'string' ? productType.trim().toLowerCase() : '';
  if (!raw) return null;
  if (raw.includes('glass')) return 'Glasspad';
  if (raw.includes('alfombr')) return 'Alfombra';
  if (raw === 'ultra' || raw.includes('ultra')) return 'Ultra';
  return null;
}

/**
 * @param {{ material?: unknown, productType?: unknown }} input
 * @returns {{ material: string, message: string } | null}
 */
export function findOutOfStockMaterial(input = {}) {
  const fromMaterial = resolveOutOfStockMaterial(input.material);
  if (fromMaterial) {
    return {
      material: fromMaterial,
      message: `${fromMaterial} no está disponible (sin stock).`,
    };
  }
  const fromType = resolveOutOfStockProductType(input.productType);
  if (fromType) {
    return {
      material: fromType,
      message: `${fromType} no está disponible (sin stock).`,
    };
  }
  return null;
}
