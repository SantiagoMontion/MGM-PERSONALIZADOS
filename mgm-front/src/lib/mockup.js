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
  let targetLongestPx = Math.round((longestCm / 90) * maxContent);
  if (!Number.isFinite(targetLongestPx) || targetLongestPx <= 0) {
    targetLongestPx = maxContent;
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

  ctx.drawImage(image, dx, dy, drawW, drawH);

  if (opts.productType === 'glasspad') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(dx, dy, drawW, drawH);
    ctx.restore();
  }

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
