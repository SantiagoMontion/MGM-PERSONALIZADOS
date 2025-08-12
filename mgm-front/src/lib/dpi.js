const CM_PER_IN = 2.54;

export function dpiFor(cmW, cmH, pxW, pxH) {
  const dpiW = pxW / (cmW / CM_PER_IN);
  const dpiH = pxH / (cmH / CM_PER_IN);
  return Math.min(dpiW, dpiH);
}

// antes: (warn=300, low=220)
export function dpiLevel(dpi, warn = 300, low = 100) {
  if (dpi >= warn) return 'ok';
  if (dpi >= low) return 'warn';  // “medio/aceptable”
  return 'bad';
}