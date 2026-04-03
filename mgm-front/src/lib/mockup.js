import { getMockupPadRect1080, CANVAS_SIZE } from './mockupPadPlacement.js';

export async function renderMockup1080(imageOrOptions, maybeOptions) {
  let image = imageOrOptions;
  let opts = maybeOptions;
  if (!maybeOptions && (imageOrOptions?.image || imageOrOptions?.composition || imageOrOptions?.productType)) {
    opts = imageOrOptions || {};
    image = opts?.composition?.canvas || opts?.composition?.image || opts?.image;
  }

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

  const placement = getMockupPadRect1080(options, fallbackWidth, fallbackHeight);
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const x = placement?.x;
  const y = placement?.y;
  const targetW = placement?.targetW;
  const targetH = placement?.targetH;
  const padRadiusPx = placement?.radiusPx ?? 18;

  if (!placement) {
    console.warn('[renderMockup1080] placement_failed', { fallbackWidth, fallbackHeight });
  } else {
    console.log('[renderMockup1080] dimensions', {
      targetW,
      targetH,
      x,
      y,
      radiusPx: padRadiusPx,
      imageW: fallbackWidth,
      imageH: fallbackHeight,
    });
  }

  const abortWithEmpty = async () => {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return blob || new Blob([], { type: 'image/png' });
  };

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(targetW) || !Number.isFinite(targetH)) {
    return await abortWithEmpty();
  }

  ctx.save();
  roundRectPath(ctx, x, y, targetW, targetH, padRadiusPx);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.clip();
  ctx.drawImage(drawable, x, y, targetW, targetH);
  ctx.restore();

  ctx.beginPath();
  roundRectPath(ctx, x, y, targetW, targetH, padRadiusPx);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#d1d5db';
  ctx.stroke();

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
