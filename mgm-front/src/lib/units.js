export const CM_PER_INCH = 2.54;

export function cmToPxAtDpi(cm, dpi = 300) {
  return (cm / CM_PER_INCH) * dpi;
}

export function mmToCm(mm) {
  return mm / 10;
}
