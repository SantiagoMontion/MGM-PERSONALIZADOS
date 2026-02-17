export type GlasspadOpts = {
  blurPx?: number;
  shadowOffsetPx?: number;
  shadowBlurPx?: number;
  shadowAlpha?: number;
  borderAlpha?: number;
};


function isFirefoxBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /firefox/i.test(navigator.userAgent || '');
}

function drawFirefoxSoftBlur(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  blurPx: number,
): void {
  const radius = Math.max(1, Math.round(blurPx));
  const offsets = [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
    [Math.round(radius * 0.65), Math.round(radius * 0.65)],
    [-Math.round(radius * 0.65), Math.round(radius * 0.65)],
    [Math.round(radius * 0.65), -Math.round(radius * 0.65)],
    [-Math.round(radius * 0.65), -Math.round(radius * 0.65)],
  ] as const;

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = Math.min(0.22, 1 / offsets.length + 0.08);
  for (const [x, y] of offsets) {
    ctx.drawImage(source, x, y);
  }
  ctx.globalAlpha = previousAlpha;
}

// baseCanvas: canvas con el arte SIN efectos
export function renderGlasspadPNG(
  baseCanvas: HTMLCanvasElement,
  opts: GlasspadOpts = {},
): HTMLCanvasElement {
  const baseSize = Math.max(baseCanvas.width, baseCanvas.height);
  const {
    blurPx = 1,
    shadowOffsetPx,
    shadowBlurPx,
    shadowAlpha = 0.18,
    borderAlpha = 0.12,
  } = opts;

  const out = document.createElement('canvas');
  out.width = baseCanvas.width;
  out.height = baseCanvas.height;
  const ctx = out.getContext('2d')!;

  const blurred = document.createElement('canvas');
  blurred.width = baseCanvas.width;
  blurred.height = baseCanvas.height;
  const blurredCtx = blurred.getContext('2d')!;
  const useFirefoxFallback = isFirefoxBrowser() && blurPx > 0;

  if (useFirefoxFallback) {
    drawFirefoxSoftBlur(blurredCtx, baseCanvas, blurPx);
  } else {
    blurredCtx.filter = `blur(${blurPx}px)`;
    blurredCtx.drawImage(baseCanvas, 0, 0);
    blurredCtx.filter = 'none';
  }

  const offset = typeof shadowOffsetPx === 'number'
    ? shadowOffsetPx
    : Math.max(1, Math.round(Math.min(baseSize * 0.007, 24)));
  const dropBlur = typeof shadowBlurPx === 'number'
    ? shadowBlurPx
    : Math.max(2, Math.round(Math.min(baseSize * 0.02, 40)));

  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`;
  ctx.shadowBlur = dropBlur;
  ctx.shadowOffsetX = offset;
  ctx.shadowOffsetY = offset;
  ctx.drawImage(blurred, 0, 0);
  ctx.restore();

  ctx.drawImage(blurred, 0, 0);

  if (borderAlpha > 0) {
    ctx.lineWidth = Math.max(1, Math.floor(out.width * 0.002));
    ctx.strokeStyle = `rgba(0,0,0,${borderAlpha})`;
    ctx.strokeRect(
      ctx.lineWidth / 2,
      ctx.lineWidth / 2,
      out.width - ctx.lineWidth,
      out.height - ctx.lineWidth,
    );
  }

  return out;
}

export default renderGlasspadPNG;

