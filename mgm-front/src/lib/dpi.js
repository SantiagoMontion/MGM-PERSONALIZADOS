const CM_PER_IN = 2.54;
const FULL_HD_WIDTH_PX = 1920;
const LARGE_PRODUCT_MIN_CM = 60;

// Umbrales más permisivos: antes 140/70, ahora 120/50.
export const DPI_WARN_THRESHOLD = 120;
export const DPI_LOW_THRESHOLD = 50;

/**
 * Referencia de calidad solo por resolución del archivo (píxeles).
 * No usa el tamaño del mousepad: evita marcar "baja" a fotos grandes que se imprimen bien en sublimación.
 *
 * - ok: archivo amplio para uso habitual
 * - warn: usable; detalle fino puede ser limitado
 * - bad: muy pocos píxeles; conviene subir algo más grande
 */
const INTRINSIC_BAD_SHORT_PX = 650;
const INTRINSIC_BAD_LONG_PX = 950;
const INTRINSIC_BAD_MP = 0.4;
const INTRINSIC_OK_MP = 1.35;
const INTRINSIC_OK_SHORT_PX = 1000;
const INTRINSIC_OK_LONG_PX = 1500;

export function intrinsicImageQualityLevel(naturalWidth, naturalHeight) {
  const w = Math.max(0, Number(naturalWidth) || 0);
  const h = Math.max(0, Number(naturalHeight) || 0);
  if (w < 1 || h < 1) return null;

  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);
  const mp = (w * h) / 1_000_000;

  if (shortSide < INTRINSIC_BAD_SHORT_PX || longSide < INTRINSIC_BAD_LONG_PX || mp < INTRINSIC_BAD_MP) {
    return 'bad';
  }
  if (mp >= INTRINSIC_OK_MP || (shortSide >= INTRINSIC_OK_SHORT_PX && longSide >= INTRINSIC_OK_LONG_PX)) {
    return 'ok';
  }
  return 'warn';
}

export function dpiFor(cmW, cmH, pxW, pxH) {
  const dpiW = pxW / (cmW / CM_PER_IN);
  const dpiH = pxH / (cmH / CM_PER_IN);
  return Math.min(dpiW, dpiH);
}

// antes: (warn=300, low=220)
export function dpiLevel(dpi, warn = DPI_WARN_THRESHOLD, low = DPI_LOW_THRESHOLD) {
  if (dpi >= warn) return 'ok';
  if (dpi >= low) return 'warn';  // “medio/aceptable”
  return 'bad';
}

export function isLargeProduct(sizeCm) {
  const widthCm = Number(sizeCm?.w || 0);
  const heightCm = Number(sizeCm?.h || 0);
  const largestSide = Math.max(widthCm, heightCm);
  return largestSide >= LARGE_PRODUCT_MIN_CM;
}

export function qualityLevel({
  dpi,
  naturalWidth,
  sizeCm,
  warn = DPI_WARN_THRESHOLD,
  low = DPI_LOW_THRESHOLD,
}) {
  const baseLevel = dpiLevel(dpi, warn, low);
  if (baseLevel === 'bad' && Number(naturalWidth) > FULL_HD_WIDTH_PX && isLargeProduct(sizeCm)) {
    return 'warn';
  }
  return baseLevel;
}