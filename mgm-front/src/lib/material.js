export const GLASSPAD_SIZE_CM = { w: 49, h: 42 };

/** Mínimo ancho/alto (cm) para medidas personalizadas en Classic, PRO y Alfombra. */
export const CUSTOM_PAD_MIN_DIMENSION_CM = 15;

/** Misma medida fija 49×42 cm y mismas reglas de tamaño que Glasspad (sin personalizar). */
export function isFixedPad49x42Material(material) {
  const m = String(material ?? '').trim();
  return m === 'Glasspad' || m === 'Ultra';
}

export const DEFAULT_SIZE_CM = {
  Classic: { w: 90, h: 40 },
  PRO: { w: 90, h: 40 },
  Alfombra: { w: 90, h: 40 },
  Glasspad: { ...GLASSPAD_SIZE_CM },
  Ultra: { ...GLASSPAD_SIZE_CM },
};

export const MIN_DIMENSION_CM_BY_MATERIAL = {
  Classic: { w: CUSTOM_PAD_MIN_DIMENSION_CM, h: CUSTOM_PAD_MIN_DIMENSION_CM },
  PRO: { w: CUSTOM_PAD_MIN_DIMENSION_CM, h: CUSTOM_PAD_MIN_DIMENSION_CM },
  Alfombra: { w: CUSTOM_PAD_MIN_DIMENSION_CM, h: CUSTOM_PAD_MIN_DIMENSION_CM },
  Glasspad: { ...GLASSPAD_SIZE_CM },
  Ultra: { ...GLASSPAD_SIZE_CM },
};

export const LIMITS = {
  Classic: { maxW: 140, maxH: 100 },
  PRO: { maxW: 120, maxH: 60 },
  Alfombra: { maxW: 140, maxH: 100 },
  Glasspad: { maxW: GLASSPAD_SIZE_CM.w, maxH: GLASSPAD_SIZE_CM.h },
  Ultra: { maxW: GLASSPAD_SIZE_CM.w, maxH: GLASSPAD_SIZE_CM.h },
};

export const STANDARD = {
  Classic: [
    { w: 25, h: 25 },
    { w: 82, h: 32 },
    { w: 90, h: 40 },
    { w: 100, h: 60 },
    { w: 140, h: 100 },
  ],
  PRO: [
    { w: 25, h: 25 },
    { w: 50, h: 40 },
    { w: 82, h: 32 },
    { w: 90, h: 40 },
    { w: 120, h: 60 },
  ],
  Alfombra: [
    { w: 25, h: 25 },
    { w: 82, h: 32 },
    { w: 90, h: 40 },
    { w: 100, h: 60 },
    { w: 140, h: 100 },
  ],
  Glasspad: [GLASSPAD_SIZE_CM],
  Ultra: [GLASSPAD_SIZE_CM],
};

export function normalizeMaterialLabel(value) {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('glass')) return 'Glasspad';
  if (text.includes('ultra')) return 'Ultra';
  if (text.includes('alfombr')) return 'Alfombra';
  if (text.includes('pro')) return 'PRO';
  if (text.includes('classic')) return 'Classic';
  return 'Classic';
}
