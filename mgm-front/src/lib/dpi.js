const CM_PER_IN = 2.54;
const FULL_HD_WIDTH_PX = 1920;
const LARGE_PRODUCT_MIN_CM = 60;

export const DPI_WARN_THRESHOLD = 140;
export const DPI_LOW_THRESHOLD = 70;

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