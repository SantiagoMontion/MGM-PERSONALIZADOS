// Genera mockup 1080×1080 en Worker con OffscreenCanvas
// Entrada: { cmd:'mockup', buffer:ArrayBuffer, opts }
// Salida:  { ok:true, type:'mockup', buffer:ArrayBuffer }

import { CANVAS_SIZE, applyStraightStorageOptions, drawMockupComposite, getMockupPadRect1080 } from '../lib/mockupPadPlacement.js';

self.onmessage = async (event) => {
  const { cmd, buffer, opts } = event.data || {};
  if (cmd !== 'mockup' || !buffer) {
    self.postMessage({ ok: false, type: 'mockup' });
    return;
  }
  try {
    const blob = new Blob([buffer]);
    const image = await createImageBitmap(blob);
    const options = opts?.straightStorage === true
      ? (opts || {})
      : applyStraightStorageOptions(opts || {});
    const placement = getMockupPadRect1080(options, image.width, image.height);
    if (!placement) {
      self.postMessage({ ok: false, type: 'mockup' });
      return;
    }

    const offscreen = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = offscreen.getContext('2d', { desynchronized: true, alpha: true });
    if (!ctx) throw new Error('2d context unavailable');

    drawMockupComposite(ctx, image, placement, options);

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
