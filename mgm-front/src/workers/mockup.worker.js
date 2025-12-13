// Genera mockup 1080x1080 en Worker con OffscreenCanvas
// Entrada: { cmd:'mockup', buffer:ArrayBuffer, opts }
// Salida:  { ok:true, type:'mockup', buffer:ArrayBuffer }

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const CANVAS_SIZE = 1080;
const CLASSIC_MAX_LONG_PX = Number(env?.VITE_MOCKUP_CLASSIC_MAX_LONG_PX) || 990;
const CLASSIC_MIN_LONG_PX = Number(env?.VITE_MOCKUP_CLASSIC_MIN_LONG_PX) || 400;
const GLASS_MAX_LONG_PX = Number(env?.VITE_MOCKUP_GLASSPAD_MAX_LONG_PX) || 860;
const GLASS_MIN_LONG_PX = Number(env?.VITE_MOCKUP_GLASSPAD_MIN_LONG_PX) || 420;
const GLASS_FIXED_LONG_PX = Number(env?.VITE_MOCKUP_GLASSPAD_FIXED_LONG_PX) || 700;

function materialLabelFromOpts(opts) {
  const raw = String((opts?.material || opts?.materialLabel || opts?.options?.material || '')).toLowerCase();
  if (raw.includes('glass')) return 'Glasspad';
  if (raw.includes('pro')) return 'PRO';
  return 'Classic';
}

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

function pickLongPx(compW, compH, compWcm, compHcm, mat) {
  const ratio = compW / Math.max(1, compH);
  const materialLabel = materialLabelFromOpts({ material: mat });
  let longPx;
  if (materialLabel === 'Glasspad') {
    longPx = Math.max(GLASS_MIN_LONG_PX, Math.min(GLASS_MAX_LONG_PX, GLASS_FIXED_LONG_PX));
  } else if (Number.isFinite(compWcm) && Number.isFinite(compHcm) && compWcm > 0 && compHcm > 0) {
    const longCm = Math.max(compWcm, compHcm);
    const t = Math.max(0, Math.min(1, (longCm - 20) / (140 - 20)));
    const mapped = Math.round(CLASSIC_MIN_LONG_PX + (CLASSIC_MAX_LONG_PX - CLASSIC_MIN_LONG_PX) * Math.pow(t, 1.08));
    longPx = Math.max(CLASSIC_MIN_LONG_PX, Math.min(CLASSIC_MAX_LONG_PX, mapped));
  }

  if (!Number.isFinite(longPx)) {
    const longest = Math.max(compW, compH);
    const scale = longest > 0 ? Math.min(1, CANVAS_SIZE / longest) : 1;
    return { w: Math.max(1, Math.round(compW * scale)), h: Math.max(1, Math.round(compH * scale)) };
  }

  if (ratio >= 1) {
    return { w: longPx, h: Math.max(1, Math.round(longPx / ratio)) };
  }
  return { h: longPx, w: Math.max(1, Math.round(longPx * ratio)) };
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
    const compW = Number(opts?.composition?.widthPx || image.width);
    const compH = Number(opts?.composition?.heightPx || image.height);
    const compWcm = Number(opts?.composition?.widthCm);
    const compHcm = Number(opts?.composition?.heightCm);
    const mat = opts?.material || opts?.materialLabel;
    const radiusPx = Number(opts?.radiusPx || 8);

    const offscreen = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = offscreen.getContext('2d', { desynchronized: true, alpha: true });
    if (!ctx) throw new Error('2d context unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    roundRectPath(ctx, 0, 0, CANVAS_SIZE, CANVAS_SIZE, radiusPx);
    ctx.clip();
    ctx.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.restore();

    const outBlob = await offscreen.convertToBlob({ type: 'image/png' });
    const outBuf = await outBlob.arrayBuffer();
    self.postMessage({ ok: true, type: 'mockup', buffer: outBuf }, [outBuf]);
  } catch (err) {
    self.postMessage({ ok: false, type: 'mockup', error: String(err) });
  }
};
