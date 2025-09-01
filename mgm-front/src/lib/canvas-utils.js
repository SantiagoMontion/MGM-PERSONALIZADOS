export function clampZoom(value, min = 0.25, max = 4) {
  return Math.min(Math.max(value, min), max);
}
