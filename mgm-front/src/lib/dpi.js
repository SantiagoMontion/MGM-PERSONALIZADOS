const CM_PER_IN = 2.54;

export const DPI_WARN_THRESHOLD = 260;
export const DPI_LOW_THRESHOLD = 90;

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