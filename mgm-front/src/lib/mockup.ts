const CANVAS = 1080;

function pathRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number) {
  const rr = Math.min(rad, w / 2, h / 2);
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

export async function renderMockup1080(canvas: HTMLCanvasElement, src: ImageBitmap | Blob | HTMLImageElement, w_cm: number, h_cm: number, material: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context');
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  ctx.clearRect(0,0,CANVAS,CANVAS);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let bitmap: ImageBitmap;
  if ('width' in src && 'height' in src && 'close' in src) {
    bitmap = src as ImageBitmap;
  } else if (src instanceof Blob) {
    bitmap = await createImageBitmap(src);
  } else if (src instanceof HTMLImageElement) {
    if (!src.complete) await src.decode();
    bitmap = await createImageBitmap(src);
  } else {
    throw new Error('unsupported src');
  }

  const REF = material === 'Glasspad' ? {W:50,H:40} : {W:140,H:100};
  const MIN_DIAG = Math.hypot(25,25);
  const MAX_DIAG = Math.hypot(REF.W, REF.H);
  const diag = Math.hypot(w_cm, h_cm);
  let t = (diag - MIN_DIAG) / (MAX_DIAG - MIN_DIAG);
  t = Math.max(0, Math.min(1, t));
  const PX_CM_SMALL = 15.0;
  const PX_CM_LARGE = 6.3;
  const pxPerCm = PX_CM_SMALL + (PX_CM_LARGE - PX_CM_SMALL) * t;

  let target_w = Math.max(1, Math.round(w_cm * pxPerCm));
  let target_h = Math.max(1, Math.round(h_cm * pxPerCm));

  const MIN_MARGIN = 80;
  const avail = CANVAS - 2 * MIN_MARGIN;
  if (target_w > avail || target_h > avail) {
    const s = Math.min(avail / target_w, avail / target_h);
    target_w = Math.max(1, Math.round(target_w * s));
    target_h = Math.max(1, Math.round(target_h * s));
  }

  const dx = Math.round((CANVAS - target_w) / 2);
  const dy = Math.round((CANVAS - target_h) / 2);
  const r = Math.max(12, Math.min(Math.min(target_w, target_h) * 0.02, 20));

  console.log('[MOCKUP DEBUG]', { w_cm, h_cm, t, pxPerCm, target_w, target_h, dx, dy });

  ctx.save();
  pathRoundedRect(ctx, dx, dy, target_w, target_h, r);
  ctx.clip();
  ctx.drawImage(bitmap, dx, dy, target_w, target_h);
  ctx.restore();

  pathRoundedRect(ctx, dx, dy, target_w, target_h, r);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();

  const inset = 4;
  const seamR = Math.max(0, r - inset);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.setLineDash([3,3]);
  pathRoundedRect(ctx, dx + inset, dy + inset, target_w - 2*inset, target_h - 2*inset, seamR);
  ctx.stroke();
  ctx.restore();

  const inset2 = 2;
  const innerR2 = Math.max(0, r - inset2);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.setLineDash([]);
  pathRoundedRect(ctx, dx + inset2, dy + inset2, target_w - 2*inset2, target_h - 2*inset2, innerR2);
  ctx.stroke();
  ctx.restore();
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
