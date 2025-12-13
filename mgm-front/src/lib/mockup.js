export async function renderMockup1080(imageOrOptions, maybeOptions) {
  let image = imageOrOptions;
  let opts = maybeOptions;
  if (!maybeOptions && (imageOrOptions?.image || imageOrOptions?.composition || imageOrOptions?.productType)) {
    opts = imageOrOptions || {};
    image = opts?.composition?.canvas || opts?.composition?.image || opts?.image;
  }

  const CANVAS_SIZE = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  if (!image) {
    const emptyBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return emptyBlob || new Blob([], { type: 'image/png' });
  }

  const options = opts || {};
  const drawSource = options?.composition?.canvas || options?.composition?.image || image;
  let drawable = drawSource;

  const CLASSIC_MAX_LONG_PX = Number(
    import.meta.env?.VITE_MOCKUP_CLASSIC_MAX_LONG_PX ??
    import.meta.env?.VITE_MOCKUP_MAX_LONG_PX,
  ) || 990;
  const CLASSIC_MIN_LONG_PX = Number(
    import.meta.env?.VITE_MOCKUP_CLASSIC_MIN_LONG_PX ??
    import.meta.env?.VITE_MOCKUP_MIN_LONG_PX,
  ) || 400;
  const CLASSIC_REF_MAX_LONG_CM = Number(
    import.meta.env?.VITE_CLASSIC_REF_MAX_LONG_CM ??
    import.meta.env?.VITE_REF_MAX_CM_CLASSIC ??
    import.meta.env?.VITE_REF_MAX_CM_PRO,
  ) || 140;
  const CLASSIC_REF_MIN_LONG_CM = Number(
    import.meta.env?.VITE_CLASSIC_REF_MIN_LONG_CM ??
    import.meta.env?.VITE_REF_MIN_CM,
  ) || 20;
  const GLASS_MAX_LONG_PX = Number(
    import.meta.env?.VITE_MOCKUP_GLASSPAD_MAX_LONG_PX ??
    import.meta.env?.VITE_MOCKUP_GLASS_MAX_LONG_PX ??
    import.meta.env?.VITE_MOCKUP_MAX_LONG_PX,
  ) || 860;
  const GLASS_MIN_LONG_PX = Number(
    import.meta.env?.VITE_MOCKUP_GLASSPAD_MIN_LONG_PX ??
    import.meta.env?.VITE_MOCKUP_GLASS_MIN_LONG_PX ??
    import.meta.env?.VITE_MOCKUP_MIN_LONG_PX,
  ) || 420;
  const GLASS_REF_MAX_LONG_CM = Number(
    import.meta.env?.VITE_GLASSPAD_REF_MAX_LONG_CM ??
    import.meta.env?.VITE_REF_MAX_CM_GLASS,
  ) || 49;
  const GLASS_REF_MIN_LONG_CM = Number(
    import.meta.env?.VITE_GLASSPAD_REF_MIN_LONG_CM ??
    import.meta.env?.VITE_REF_MIN_CM,
  ) || 20;
  const GLASS_FIXED_LONG_PX = Number(import.meta.env?.VITE_MOCKUP_GLASSPAD_FIXED_LONG_PX) || 700;
  const RADIUS_PX = Number(import.meta.env?.VITE_MOCKUP_PAD_RADIUS_PX) || 8;

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

  function materialLabelFromOpts(opts) {
    const raw = String(
      opts?.material ||
      opts?.materialLabel ||
      opts?.options?.material ||
      opts?.composition?.material ||
      opts?.productType ||
      ''
    ).toLowerCase();
    if (raw.includes('glass')) return 'Glasspad';
    if (raw.includes('alfombr')) return 'Alfombra';
    if (raw.includes('pro')) return 'PRO';
    return 'Classic';
  }

  function mapLongPxByMaterial(longCm, material) {
    const isGlass = material === 'Glasspad';
    const maxPx = isGlass ? GLASS_MAX_LONG_PX : CLASSIC_MAX_LONG_PX;
    const minPx = isGlass ? GLASS_MIN_LONG_PX : CLASSIC_MIN_LONG_PX;
    const refMax = isGlass ? GLASS_REF_MAX_LONG_CM : CLASSIC_REF_MAX_LONG_CM;
    const refMin = isGlass ? GLASS_REF_MIN_LONG_CM : CLASSIC_REF_MIN_LONG_CM;
    const span = Math.max(1, refMax - refMin);
    const tRaw = (Number(longCm) - refMin) / span;
    const t = Math.max(0, Math.min(1, tRaw));
    const exp = isGlass ? 1.25 : 1.08;
    const eased = Math.pow(t, exp);
    return Math.round(minPx + (maxPx - minPx) * eased);
  }

  const anySource = drawSource || {};
  const bitmapCandidate = drawSource || image;
  if (typeof createImageBitmap === 'function' && bitmapCandidate && !('close' in bitmapCandidate)) {
    try {
      drawable = await createImageBitmap(bitmapCandidate);
    } catch (err) {
      drawable = drawSource;
    }
  }
  const fallbackWidth = Number(anySource.width || anySource.naturalWidth || anySource.videoWidth || 0);
  const fallbackHeight = Number(anySource.height || anySource.naturalHeight || anySource.videoHeight || 0);
  const compWidthPx = Number(
    options?.composition?.widthPx ??
    options?.composition?.width_px ??
    options?.widthPx ??
    options?.width_px ??
    fallbackWidth
  );
  const compHeightPx = Number(
    options?.composition?.heightPx ??
    options?.composition?.height_px ??
    options?.heightPx ??
    options?.height_px ??
    fallbackHeight
  );

  let widthMm = Number(
    options?.composition?.widthMm ??
    options?.composition?.width_mm ??
    options?.widthMm ??
    options?.width_mm ??
    0
  );
  let heightMm = Number(
    options?.composition?.heightMm ??
    options?.composition?.height_mm ??
    options?.heightMm ??
    options?.height_mm ??
    0
  );

  const legacyWidthCm = Number(
    options?.composition?.widthCm ??
    options?.composition?.width_cm ??
    options?.widthCm ??
    options?.width_cm ??
    0
  );
  const legacyHeightCm = Number(
    options?.composition?.heightCm ??
    options?.composition?.height_cm ??
    options?.heightCm ??
    options?.height_cm ??
    0
  );
  if ((!Number.isFinite(widthMm) || widthMm <= 0) && Number.isFinite(legacyWidthCm) && legacyWidthCm > 0) {
    widthMm = legacyWidthCm * 10;
  }
  if ((!Number.isFinite(heightMm) || heightMm <= 0) && Number.isFinite(legacyHeightCm) && legacyHeightCm > 0) {
    heightMm = legacyHeightCm * 10;
  }

  const dpiCandidates = [
    options?.composition?.dpi,
    options?.dpi,
    options?.approxDpi,
  ];
  const safeDpi = dpiCandidates.reduce((acc, value) => {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return acc ?? num;
    }
    return acc;
  }, null);
  const dpi = Number.isFinite(safeDpi) && safeDpi
    ? Number(safeDpi)
    : 300;
  const pxToMm = (px) => (Number(px) || 0) / dpi * 25.4;

  if (!Number.isFinite(widthMm) || widthMm <= 0) {
    widthMm = pxToMm(compWidthPx || fallbackWidth);
  }
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    heightMm = pxToMm(compHeightPx || fallbackHeight);
  }

  const widthCm = Number.isFinite(widthMm) ? widthMm / 10 : 0;
  const heightCm = Number.isFinite(heightMm) ? heightMm / 10 : 0;
  const longestCm = Math.max(widthCm, heightCm, 0);

  const matLabel = materialLabelFromOpts(options) || 'Classic';

  const aspect = compWidthPx > 0 && compHeightPx > 0
    ? compWidthPx / compHeightPx
    : fallbackWidth > 0 && fallbackHeight > 0
      ? fallbackWidth / fallbackHeight
      : 1;
  // Glasspad: usar largo fijo para que no “llene” el 1080x1080
  let longPx = matLabel === 'Glasspad'
    ? GLASS_FIXED_LONG_PX
    : mapLongPxByMaterial(longestCm, matLabel);
  if (!Number.isFinite(longPx) || longPx <= 0) {
    longPx = mapLongPxByMaterial(CLASSIC_REF_MIN_LONG_CM, matLabel);
  }
  const maxAllowed = matLabel === 'Glasspad' ? GLASS_MAX_LONG_PX : CLASSIC_MAX_LONG_PX;
  longPx = Math.max(1, Math.min(longPx, maxAllowed));

  let targetW;
  let targetH;
  if (aspect >= 1) {
    targetW = longPx;
    targetH = Math.max(1, Math.round(longPx / Math.max(aspect, 1e-6)));
  } else {
    targetH = longPx;
    targetW = Math.max(1, Math.round(longPx * aspect));
  }
  if (targetW > CANVAS_SIZE) {
    const scale = CANVAS_SIZE / targetW;
    targetW = CANVAS_SIZE;
    targetH = Math.max(1, Math.round(targetH * scale));
  }
  if (targetH > CANVAS_SIZE) {
    const scale = CANVAS_SIZE / targetH;
    targetH = CANVAS_SIZE;
    targetW = Math.max(1, Math.round(targetW * scale));
  }

  if (!Number.isFinite(targetW) || !Number.isFinite(targetH)) {
    targetW = CANVAS_SIZE;
    targetH = CANVAS_SIZE;
  }
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.save();
  roundRectPath(ctx, 0, 0, CANVAS_SIZE, CANVAS_SIZE, RADIUS_PX);
  ctx.clip();
  const imgW = Math.max(1, Number(drawable?.width || drawable?.naturalWidth || 0));
  const imgH = Math.max(1, Number(drawable?.height || drawable?.naturalHeight || 0));
  const coverScale = Math.max(CANVAS_SIZE / imgW, CANVAS_SIZE / imgH);
  const w = imgW * coverScale;
  const h = imgH * coverScale;
  const x = (CANVAS_SIZE - w) / 2;
  const y = (CANVAS_SIZE - h) / 2;
  ctx.drawImage(drawable, x, y, w, h);
  ctx.restore();

  if (drawable && typeof drawable.close === 'function') {
    try {
      drawable.close();
    } catch (_) {}
  }

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return blob || new Blob([], { type: 'image/png' });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
