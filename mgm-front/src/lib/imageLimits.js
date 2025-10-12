export function getMaxImageMb() {
  const n = Number(import.meta.env?.VITE_MAX_IMAGE_MB);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function bytesToMB(b) {
  return Math.round((b / 1024 / 1024) * 10) / 10;
}

export function formatHeavyImageToastMessage(actualMb, maxMb) {
  const actualNumber = Number(actualMb);
  const formattedActual = Number.isFinite(actualNumber)
    ? actualNumber.toFixed(1)
    : (actualMb != null ? String(actualMb) : '?');
  const maxNumber = Number(maxMb);
  const formattedMax = Number.isFinite(maxNumber)
    ? maxNumber.toString()
    : (maxMb != null ? String(maxMb) : '?');
  return `Archivo demasiado pesado (${formattedActual} MB).\n`
    + `Máximo permitido: ${formattedMax} MB.\n`
    + 'Subí una imagen más liviana.';
}
