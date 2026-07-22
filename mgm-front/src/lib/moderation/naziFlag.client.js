/**
 * Gate rápido en cliente para bandera nazi clásica (rojo + disco claro + negro).
 * No reemplaza al servidor; corta el flujo antes si el patrón es obvio.
 */
export function scanNaziFlagClient(imageData) {
  if (!imageData?.data || !imageData.width || !imageData.height) {
    return { blocked: false };
  }
  const { data, width: w, height: h } = imageData;
  const total = w * h;
  if (total < 64) return { blocked: false };

  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const radius = Math.floor(Math.min(w, h) * 0.42);
  let red = 0;
  let inCircle = 0;
  let bright = 0;
  let black = 0;
  let redInCircle = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      const maxC = Math.max(R, G, B);
      const minC = Math.min(R, G, B);
      const isRed = R > 140 && G < 130 && B < 130 && R > G + 25 && R > B + 25;
      const isBright = maxC > 165 && (maxC - minC) < 55 && R > 150 && G > 150 && B > 140;
      const isBlack = R < 85 && G < 85 && B < 85 && maxC < 95;
      if (isRed) red++;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= radius) {
        inCircle++;
        if (isRed) redInCircle++;
        if (isBright) bright++;
        if (isBlack) black++;
      }
    }
  }

  const redRatio = red / total;
  const brightRatio = inCircle ? bright / inCircle : 0;
  const blackRatio = inCircle ? black / inCircle : 0;
  const centerRed = inCircle ? redInCircle / inCircle : 0;
  const redHole = (
    redRatio >= 0.35
    && centerRed < Math.min(0.35, redRatio * 0.5)
    && brightRatio >= 0.18
  );
  // Alineado al servidor: negro denso (esvástica), no trazos finos de ilustración.
  const blocked = (
    redRatio >= 0.38
    && redHole
    && brightRatio >= 0.18
    && blackRatio >= 0.12
    && centerRed < 0.35
  );

  return {
    blocked,
    reason: blocked ? 'client_extremism_nazi' : null,
    scores: { redRatio, brightRatio, blackRatio, centerRed },
  };
}

export async function scanNaziFlagFromDataUrl(dataUrl, maxSide = 320) {
  if (!dataUrl || typeof document === 'undefined') {
    return { blocked: false };
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = dataUrl;
  await img.decode();
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  if (!iw || !ih) return { blocked: false };
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { blocked: false };
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  canvas.width = 0;
  canvas.height = 0;
  return scanNaziFlagClient(imageData);
}

export default { scanNaziFlagClient, scanNaziFlagFromDataUrl };
