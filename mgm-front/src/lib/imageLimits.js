export function getMaxImageMb() {
  const n = Number(import.meta.env?.VITE_MAX_IMAGE_MB);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function bytesToMB(b) {
  return Math.round((b / 1024 / 1024) * 10) / 10;
}
