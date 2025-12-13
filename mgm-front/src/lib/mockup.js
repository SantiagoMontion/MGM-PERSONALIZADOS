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

  const mmFromOptions = (opts) => Number(
    opts?.composition?.widthMm ??
    opts?.composition?.width_mm ??
    opts?.widthMm ??
    opts?.width_mm ??
    0
  );
  const mmFromOptionsH = (opts) => Number(
    opts?.composition?.heightMm ??
    opts?.composition?.height_mm ??
    opts?.heightMm ??
    opts?.height_mm ??
    0
  );
  const inputWidthMm = mmFromOptions(options);
  const inputHeightMm = mmFromOptionsH(options);
  let widthMm = inputWidthMm;
  let heightMm = inputHeightMm;

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

  let wMm = Number(widthMm) || 0;
  let hMm = Number(heightMm) || 0;
  if (wMm <= 0 || hMm <= 0) {
    wMm = 900;
    hMm = 400;
  }

  const widthCm = Number.isFinite(wMm) ? wMm / 10 : 0;
  const heightCm = Number.isFinite(hMm) ? hMm / 10 : 0;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const refMaxMm = (() => {
    const mm = Number(import.meta.env?.VITE_MOCKUP_REF_MAX_MM);
    if (Number.isFinite(mm) && mm > 0) return mm;
    const cm = Number(import.meta.env?.VITE_MOCKUP_REF_MAX_CM);
    if (Number.isFinite(cm) && cm > 0) return cm * 10;
    return 1400; // default reference long side in mm
  })();
  const refPixels = Number(import.meta.env?.VITE_MOCKUP_REF_PIXELS) || 1180;
  const pixelsPerMm = refPixels / Math.max(1, refMaxMm);

  let targetW = Math.max(1, wMm * pixelsPerMm);
  let targetH = Math.max(1, hMm * pixelsPerMm);
  if (targetW > CANVAS_SIZE || targetH > CANVAS_SIZE) {
    const scaleDown = Math.min(CANVAS_SIZE / targetW, CANVAS_SIZE / targetH, 1);
    targetW *= scaleDown;
    targetH *= scaleDown;
  }
  const x = (CANVAS_SIZE - targetW) / 2;
  const y = (CANVAS_SIZE - targetH) / 2;

  console.log('[renderMockup1080] dimensions', {
    optionsWidthMm: inputWidthMm,
    optionsHeightMm: inputHeightMm,
    resolvedWmm: wMm,
    resolvedHmm: hMm,
    targetW,
    targetH,
    x,
    y,
  });

  const abortWithEmpty = async () => {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return blob || new Blob([], { type: 'image/png' });
  };

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(targetW) || !Number.isFinite(targetH)) {
    return await abortWithEmpty();
  }

  ctx.save();
  roundRectPath(ctx, x, y, targetW, targetH, RADIUS_PX);
  ctx.clip();
  ctx.drawImage(drawable, x, y, targetW, targetH);
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
