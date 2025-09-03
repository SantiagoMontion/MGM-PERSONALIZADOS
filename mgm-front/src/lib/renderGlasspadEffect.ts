export type GlasspadOpts = {
  blurPx?: number;          // 1–3 px
  whiteAlpha?: number;      // 0.20–0.35
  highlightAlpha?: number;  // 0.08–0.20
};

export function renderGlasspadPNG(
  baseImage: HTMLImageElement | ImageBitmap,
  outW: number,
  outH: number,
  opts: GlasspadOpts = {}
): HTMLCanvasElement {
  const { blurPx = 2, whiteAlpha = 0.28, highlightAlpha = 0.14 } = opts;

  // lienzo de salida
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const ctx = out.getContext('2d')!;

  // 1) dibujar diseño con un ligero blur
  ctx.save();
  ctx.filter = `blur(${blurPx}px) saturate(1.03)`;
  ctx.drawImage(baseImage, 0, 0, outW, outH);
  ctx.restore();

  // 2) velo blanco lechoso
  ctx.save();
  ctx.globalAlpha = whiteAlpha;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.restore();

  // 3) highlight sutil diagonal (vidrio)
  const grd = ctx.createLinearGradient(0, 0, outW, outH);
  grd.addColorStop(0.0, `rgba(255,255,255,${highlightAlpha})`);
  grd.addColorStop(0.55, `rgba(255,255,255,${Math.max(0, highlightAlpha - 0.10)})`);
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, outW, outH);

  // 4) borde interior muy leve (opcional)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(1, Math.floor(outW * 0.002));
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, outW - ctx.lineWidth, outH - ctx.lineWidth);
  ctx.restore();

  return out;
}

export default renderGlasspadPNG;
