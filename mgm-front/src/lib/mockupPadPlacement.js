/**
 * Rectángulo del pad (proporción real del diseño exportado) dentro del lienzo 1080×1080.
 * Compartido por `mockup.js` y `mockup.worker.js` para no distorsionar el arte del Konva.
 */

const CANVAS_SIZE = 1080;
const RADIUS_PX = 18;

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function resolveMockupShape(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const composition = opts.composition && typeof opts.composition === 'object'
    ? opts.composition
    : {};
  const shape = String(
    opts.shape
    ?? composition.shape
    ?? opts.productShape
    ?? '',
  ).trim().toLowerCase();
  if (shape === 'circle') return 'circle';
  if (opts.isCircular === true || composition.isCircular === true) return 'circle';
  return 'rounded_rect';
}

export function clipMockupPadPath(ctx, x, y, w, h, radiusPx, shape = 'rounded_rect') {
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }
  roundRectPath(ctx, x, y, w, h, radiusPx);
}

/**
 * Compone el diseño sobre lienzo 1080×1080.
 * Circular: sin fondo blanco ni borde cuadrado; PNG con transparencia fuera del círculo.
 */
export function drawMockupComposite(ctx, drawable, placement, options = {}) {
  const { x, y, targetW, targetH, radiusPx } = placement || {};
  const shape = resolveMockupShape(options);
  const isCircle = shape === 'circle';

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.save();
  clipMockupPadPath(ctx, x, y, targetW, targetH, radiusPx, shape);
  if (!isCircle) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }
  ctx.clip();
  ctx.drawImage(drawable, x, y, targetW, targetH);
  ctx.restore();

  if (!isCircle) {
    ctx.beginPath();
    clipMockupPadPath(ctx, x, y, targetW, targetH, radiusPx, shape);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#d1d5db';
    ctx.stroke();
  }
}

function getEnv() {
  return (typeof import.meta !== 'undefined' && import.meta.env) || {};
}

/**
 * @param {Record<string, unknown>} opts - opciones tipo renderMockup1080 (composition, dpi, etc.)
 * @param {number} fallbackImageW
 * @param {number} fallbackImageH
 * @returns {{ x: number, y: number, targetW: number, targetH: number, canvasSize: number, radiusPx: number } | null}
 */
export function getMockupPadRect1080(opts, fallbackImageW, fallbackImageH) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const composition = options.composition && typeof options.composition === 'object'
    ? options.composition
    : {};

  const fw = Number(fallbackImageW) || 0;
  const fh = Number(fallbackImageH) || 0;

  const compWidthPx = Number(
    composition.widthPx ??
      composition.width_px ??
      options.widthPx ??
      options.width_px ??
      fw,
  );
  const compHeightPx = Number(
    composition.heightPx ??
      composition.height_px ??
      options.heightPx ??
      options.height_px ??
      fh,
  );

  let widthMm = Number(
    composition.widthMm ?? composition.width_mm ?? options.widthMm ?? options.width_mm ?? 0,
  );
  let heightMm = Number(
    composition.heightMm ?? composition.height_mm ?? options.heightMm ?? options.height_mm ?? 0,
  );

  const legacyWidthCm = Number(
    composition.widthCm ?? composition.width_cm ?? options.widthCm ?? options.width_cm ?? 0,
  );
  const legacyHeightCm = Number(
    composition.heightCm ?? composition.height_cm ?? options.heightCm ?? options.height_cm ?? 0,
  );
  if ((!Number.isFinite(widthMm) || widthMm <= 0) && Number.isFinite(legacyWidthCm) && legacyWidthCm > 0) {
    widthMm = legacyWidthCm * 10;
  }
  if ((!Number.isFinite(heightMm) || heightMm <= 0) && Number.isFinite(legacyHeightCm) && legacyHeightCm > 0) {
    heightMm = legacyHeightCm * 10;
  }

  let safeDpi = null;
  for (const value of [composition.dpi, options.dpi, options.approxDpi]) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      safeDpi = num;
      break;
    }
  }
  const dpi = Number.isFinite(safeDpi) && safeDpi ? safeDpi : 300;
  const pxToMm = (px) => (Number(px) || 0) / dpi * 25.4;

  if (!Number.isFinite(widthMm) || widthMm <= 0) {
    widthMm = pxToMm(compWidthPx || fw);
  }
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    heightMm = pxToMm(compHeightPx || fh);
  }

  let wMm = Number(widthMm) || 0;
  let hMm = Number(heightMm) || 0;
  if (wMm <= 0 || hMm <= 0) {
    wMm = 900;
    hMm = 400;
  }

  const env = getEnv();
  const refMaxMm = (() => {
    const mm = Number(env.VITE_MOCKUP_REF_MAX_MM);
    if (Number.isFinite(mm) && mm > 0) return mm;
    const cm = Number(env.VITE_MOCKUP_REF_MAX_CM);
    if (Number.isFinite(cm) && cm > 0) return cm * 10;
    return 1400;
  })();
  const refPixels = Number(env.VITE_MOCKUP_REF_PIXELS) || 1180;
  const pixelsPerMm = refPixels / Math.max(1, refMaxMm);

  let targetW = Math.max(1, wMm * pixelsPerMm);
  let targetH = Math.max(1, hMm * pixelsPerMm);
  const longSideMm = Math.max(wMm, hMm);
  if (longSideMm < 600) {
    targetW *= 1.4;
    targetH *= 1.4;
  }
  if (targetW > CANVAS_SIZE || targetH > CANVAS_SIZE) {
    const scaleDown = Math.min(CANVAS_SIZE / targetW, CANVAS_SIZE / targetH, 1);
    targetW *= scaleDown;
    targetH *= scaleDown;
  }
  const x = (CANVAS_SIZE - targetW) / 2;
  const y = (CANVAS_SIZE - targetH) / 2;

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(targetW) || !Number.isFinite(targetH)) {
    return null;
  }

  const resolvedRadiusPx = (() => {
    const candidates = [
      options.radiusPx,
      options.radius_px,
      composition.radiusPx,
      composition.radius_px,
    ];
    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.round(parsed);
      }
    }
    return RADIUS_PX;
  })();

  return {
    x,
    y,
    targetW,
    targetH,
    canvasSize: CANVAS_SIZE,
    radiusPx: resolvedRadiusPx,
  };
}

export { CANVAS_SIZE, RADIUS_PX };
