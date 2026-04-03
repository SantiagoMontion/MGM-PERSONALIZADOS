// Genera mockup 1080×1080 en Worker con OffscreenCanvas
// Entrada: { cmd:'mockup', buffer:ArrayBuffer, opts }
// Salida:  { ok:true, type:'mockup', buffer:ArrayBuffer }

import { getMockupPadRect1080, CANVAS_SIZE } from '../lib/mockupPadPlacement.js';

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

self.onmessage = async (event) => {
  const { cmd, buffer, opts } = event.data || {};
  if (cmd !== 'mockup' || !buffer) {
    self.postMessage({ ok: false, type: 'mockup' });
    return;
  }
  try {
    const blob = new Blob([buffer]);
    const image = await createImageBitmap(blob);
    const placement = getMockupPadRect1080(opts || {}, image.width, image.height);
    if (!placement) {
      self.postMessage({ ok: false, type: 'mockup' });
      return;
    }
    const { x, y, targetW, targetH, radiusPx } = placement;

    const offscreen = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = offscreen.getContext('2d', { desynchronized: true, alpha: true });
    if (!ctx) throw new Error('2d context unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.save();
    roundRectPath(ctx, x, y, targetW, targetH, radiusPx);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(image, x, y, targetW, targetH);
    ctx.restore();

    ctx.beginPath();
    roundRectPath(ctx, x, y, targetW, targetH, radiusPx);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#d1d5db';
    ctx.stroke();

    try {
      image.close();
    } catch (_) {}

    const outBlob = await offscreen.convertToBlob({ type: 'image/png' });
    const outBuf = await outBlob.arrayBuffer();
    self.postMessage({ ok: true, type: 'mockup', buffer: outBuf }, [outBuf]);
  } catch (err) {
    self.postMessage({ ok: false, type: 'mockup', error: String(err) });
  }
};
