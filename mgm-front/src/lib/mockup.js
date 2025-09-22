export async function renderMockup1080(opts) {
  const size = 1080;
  const margin = 40;
  const maxContent = size - margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) throw new Error('2d context unavailable');

  ctx.clearRect(0, 0, size, size);

  const image = opts.image || (opts.composition && opts.composition.image);
  if (!image) {
    return new Promise((res) => canvas.toBlob(res, 'image/png', 1));
  }

  const widthCm = Number(
    opts.widthCm ??
      opts.width_cm ??
      (opts.composition && (opts.composition.widthCm ?? opts.composition.width_cm)) ??
      0
  );
  const heightCm = Number(
    opts.heightCm ??
      opts.height_cm ??
      (opts.composition && (opts.composition.heightCm ?? opts.composition.height_cm)) ??
      0
  );

  const iw = image.width || image.naturalWidth || image.videoWidth || 0;
  const ih = image.height || image.naturalHeight || image.videoHeight || 0;
  if (!iw || !ih) {
    return new Promise((res) => canvas.toBlob(res, 'image/png', 1));
  }

  const longestCm = Math.max(widthCm, heightCm);
  const safeLongestCm = Number.isFinite(longestCm) ? Math.max(0, longestCm) : 0;
  const norm = safeLongestCm / 140;
  let ratio = Number.isFinite(norm) ? Math.pow(Math.max(norm, 0), 0.6) : 0;
  if (!Number.isFinite(ratio)) {
    ratio = 0;
  }
  ratio = Math.min(1, Math.max(0.26, ratio));
  let targetLongestPx = Math.round(maxContent * ratio);
  if (!Number.isFinite(targetLongestPx) || targetLongestPx <= 0) {
    targetLongestPx = Math.round(maxContent * 0.26);
  }
  targetLongestPx = Math.min(maxContent, Math.max(1, targetLongestPx));

  let drawW;
  let drawH;
  if (iw >= ih) {
    drawW = targetLongestPx;
    drawH = Math.round((ih / Math.max(1e-6, iw)) * drawW);
  } else {
    drawH = targetLongestPx;
    drawW = Math.round((iw / Math.max(1e-6, ih)) * drawH);
  }

  if (drawW > maxContent) {
    const ratio = drawH / Math.max(1e-6, drawW);
    drawW = maxContent;
    drawH = Math.round(drawW * ratio);
  }
  if (drawH > maxContent) {
    const ratio = drawW / Math.max(1e-6, drawH);
    drawH = maxContent;
    drawW = Math.round(drawH * ratio);
  }

  drawW = Math.max(1, Math.round(drawW));
  drawH = Math.max(1, Math.round(drawH));

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const dx = Math.round((size - drawW) / 2);
  const dy = Math.round((size - drawH) / 2);

  const clipRoundedRect = (context, x, y, width, height, radius) => {
    const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    context.beginPath();
    if (typeof context.roundRect === 'function') {
      context.roundRect(x, y, width, height, r);
    } else {
      context.moveTo(x + r, y);
      context.lineTo(x + width - r, y);
      context.arcTo(x + width, y, x + width, y + r, r);
      context.lineTo(x + width, y + height - r);
      context.arcTo(x + width, y + height, x + width - r, y + height, r);
      context.lineTo(x + r, y + height);
      context.arcTo(x, y + height, x, y + height - r, r);
      context.lineTo(x, y + r);
      context.arcTo(x, y, x + r, y, r);
      context.closePath();
    }
    context.clip();
  };

  ctx.save();
  clipRoundedRect(ctx, dx, dy, drawW, drawH, 12);

  let drewGlassEffect = false;
  if (opts.productType === 'glasspad') {
    const glassCanvas = document.createElement('canvas');
    glassCanvas.width = drawW;
    glassCanvas.height = drawH;
    const glassCtx = glassCanvas.getContext('2d');

    if (glassCtx) {
      const blurPx = 1;

      glassCtx.filter = `blur(${blurPx}px)`;
      glassCtx.drawImage(image, 0, 0, drawW, drawH);
      glassCtx.filter = 'none';

      ctx.drawImage(glassCanvas, dx, dy, drawW, drawH);
      drewGlassEffect = true;
    }
  }

  if (!drewGlassEffect) {
    ctx.drawImage(image, dx, dy, drawW, drawH);
  }

  ctx.restore();

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png', 1));
  return blob;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
