export type MockupOptions = {
  productType: 'mousepad' | 'glasspad';
  composition: {
    image: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
    offsetX?: number;
    offsetY?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number; // degrees
    printableRect?: { x: number; y: number; w: number; h: number };
  };
  background?: string;
};

export async function renderMockup1080(opts: MockupOptions): Promise<Blob> {
  const size = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // background
  ctx.fillStyle = opts.background || '#f5f5f5';
  ctx.fillRect(0, 0, size, size);

  // draw base art
  ctx.save();
  const cx = size / 2;
  const cy = size / 2;
  const comp = opts.composition;
  ctx.translate(cx + (comp.offsetX || 0), cy + (comp.offsetY || 0));
  ctx.rotate(((comp.rotation || 0) * Math.PI) / 180);
  ctx.scale(comp.scaleX || 1, comp.scaleY || 1);
  const img = comp.image as HTMLImageElement | HTMLCanvasElement;
  const iw =
    'width' in img && img.width
      ? img.width
      : (img as any).naturalWidth || 0;
  const ih =
    'height' in img && img.height
      ? img.height
      : (img as any).naturalHeight || 0;
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();

  // glasspad overlay
  if (opts.productType === 'glasspad') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png', 1)
  );
  return blob;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

