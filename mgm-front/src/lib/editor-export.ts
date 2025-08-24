export function cmToPx(cm: number, dpi: number): number {
  return Math.round((cm / 2.54) * dpi);
}

export async function blobToSHA256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

interface RenderTransform {
  x: number;
  y: number;
  scale: number;
  rotateDeg: number;
  fitMode: 'cover' | 'contain' | 'stretch';
}

interface RenderOpts {
  image: HTMLImageElement | ImageBitmap;
  widthPx: number;
  heightPx: number;
  bg: string;
  transform: RenderTransform;
}

export async function renderToCanvas(opts: RenderOpts): Promise<HTMLCanvasElement> {
  const { image, widthPx, heightPx, bg, transform } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context missing');

  // fill background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, widthPx, heightPx);

  const scale = transform.scale ?? 1;
  const dw = image.width * scale;
  const dh = image.height * scale;

  ctx.save();
  ctx.translate(transform.x + dw / 2, transform.y + dh / 2);
  ctx.rotate((transform.rotateDeg * Math.PI) / 180);
  ctx.drawImage(image, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  return canvas;
}
