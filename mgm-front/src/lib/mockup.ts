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
  let targetLongestPx = Math.round((longestCm / 90) * maxContent);
  if (!Number.isFinite(targetLongestPx) || targetLongestPx <= 0) {
    targetLongestPx = maxContent;
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
  ctx.drawImage(image, dx, dy, drawW, drawH);

  if (opts.productType === 'glasspad') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(dx, dy, drawW, drawH);
    ctx.restore();
  }

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

