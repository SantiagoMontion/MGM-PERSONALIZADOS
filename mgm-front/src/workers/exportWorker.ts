// src/workers/exportWorker.ts
self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data || {};
  if (type !== 'export' || !payload) return;
  const canvas: OffscreenCanvas = payload.canvas;
  const kind: 'mockup'|'print'|'pdf' = payload.kind;
  try {
    (self as any).postMessage({ id, type: 'progress', pct: 50 });
    const mime = kind === 'print' ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 });
    (self as any).postMessage({ id, type: 'done', blob, kind }, [blob]);
  } catch (err) {
    (self as any).postMessage({ id, type: 'error', error: String(err) });
  }
};
export {};
