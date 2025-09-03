export type GlasspadOpts = {
  blurPx?: number;
  whiteA?: number;
  hiA?: number;
};

// baseCanvas: canvas con el arte SIN efectos
export function renderGlasspadPNG(
  baseCanvas: HTMLCanvasElement,
  opts: GlasspadOpts = {},
): HTMLCanvasElement {
  const { blurPx = 6, whiteA = 0.5, hiA = 0.3 } = opts;

  const out = document.createElement('canvas');
  out.width = baseCanvas.width;
  out.height = baseCanvas.height;
  const ctx = out.getContext('2d')!;

  ctx.filter = `blur(${blurPx}px) saturate(1.08)`;
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.filter = 'none';

  ctx.globalAlpha = whiteA;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);

  const g = ctx.createLinearGradient(0, 0, out.width, out.height);
  g.addColorStop(0, `rgba(255,255,255,${hiA})`);
  g.addColorStop(0.55, `rgba(255,255,255,${Math.max(0, hiA - 0.1)})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, out.width, out.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = Math.max(1, Math.floor(out.width * 0.002));
  ctx.strokeRect(
    ctx.lineWidth / 2,
    ctx.lineWidth / 2,
    out.width - ctx.lineWidth,
    out.height - ctx.lineWidth,
  );

  return out;
}

export default renderGlasspadPNG;

