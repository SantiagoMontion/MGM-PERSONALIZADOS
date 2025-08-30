// src/lib/exportService.ts
let worker: Worker | null = null;
let seq = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function exportCanvas(canvas: HTMLCanvasElement, kind: 'mockup'|'print'|'pdf', opts?: { signal?: AbortSignal; onProgress?:(pct:number)=>void; }): Promise<Blob> {
  if (typeof OffscreenCanvas === 'undefined') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), kind === 'print' ? 'image/jpeg' : 'image/png', 0.92);
    });
  }
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      if (!ev.data || ev.data.id !== id) return;
      if (ev.data.type === 'progress') {
        opts?.onProgress?.(ev.data.pct);
      } else if (ev.data.type === 'done') {
        w.removeEventListener('message', onMsg);
        resolve(ev.data.blob);
      } else if (ev.data.type === 'error') {
        w.removeEventListener('message', onMsg);
        reject(new Error(ev.data.error));
      }
    };
    w.addEventListener('message', onMsg);
    const off = canvas.transferControlToOffscreen();
    w.postMessage({ id, type: 'export', payload: { canvas: off, kind } }, [off]);
    opts?.signal?.addEventListener('abort', () => {
      w.removeEventListener('message', onMsg);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export function terminateExportWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
