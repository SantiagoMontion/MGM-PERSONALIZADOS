type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

type SizeOptions = {
  widthCm?: number;
  heightCm?: number;
  width_cm?: number;
  height_cm?: number;
};

export type MockupOptions = SizeOptions & {
  productType: 'mousepad' | 'glasspad';
  image?: ImageSource;
  composition?: { image: ImageSource } & SizeOptions;
};

export async function renderMockup1080(opts: MockupOptions): Promise<Blob> {
  const size = 1080;
  const margin = 40;
  const maxContent = size - margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  ctx.clearRect(0, 0, size, size);

  const toBlob = () =>
    new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png', 1)
    );

  const image = opts.image ?? opts.composition?.image;
  if (!image) {
    return toBlob();
  }

  const widthCm = Number(
    opts.widthCm ??
      opts.width_cm ??
      opts.composition?.widthCm ??
      opts.composition?.width_cm ??
      0
  );
  const heightCm = Number(
    opts.heightCm ??
      opts.height_cm ??
      opts.composition?.heightCm ??
      opts.composition?.height_cm ??
      0
  );

  const anyImg = image as any;
  const iw = Number(anyImg.width ?? anyImg.naturalWidth ?? anyImg.videoWidth ?? 0);
  const ih = Number(anyImg.height ?? anyImg.naturalHeight ?? anyImg.videoHeight ?? 0);
  if (!iw || !ih) {
    return toBlob();
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

  let drawW: number;
  let drawH: number;
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

  const dx = Math.round((size - drawW) / 2);
  const dy = Math.round((size - drawH) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const clipRoundedRect = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) => {
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
      const longestSide = Math.max(drawW, drawH);
      const blurPx = Math.max(4, Math.round(Math.min(longestSide * 0.035, 26)));

      glassCtx.filter = `blur(${blurPx}px)`;
      glassCtx.globalAlpha = 0.9;
      glassCtx.drawImage(image, 0, 0, drawW, drawH);
      glassCtx.filter = 'none';

      glassCtx.globalAlpha = 0.45;
      glassCtx.drawImage(image, 0, 0, drawW, drawH);
      glassCtx.globalAlpha = 1;

      const highlight = glassCtx.createLinearGradient(0, 0, drawW, drawH);
      highlight.addColorStop(0, 'rgba(255,255,255,0.04)');
      highlight.addColorStop(0.5, 'rgba(255,255,255,0.015)');
      highlight.addColorStop(1, 'rgba(0,0,0,0.04)');
      glassCtx.fillStyle = highlight;
      glassCtx.fillRect(0, 0, drawW, drawH);

      ctx.globalAlpha = 0.95;
      ctx.drawImage(glassCanvas, dx, dy, drawW, drawH);
      ctx.globalAlpha = 1;
      drewGlassEffect = true;
    }
  }

  if (!drewGlassEffect) {
    ctx.drawImage(image, dx, dy, drawW, drawH);
  }

  ctx.restore();

  return toBlob();
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

