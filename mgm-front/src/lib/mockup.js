import {
  CANVAS_SIZE,
  drawMockupComposite,
  getMockupPadRect1080,
} from './mockupPadPlacement.js';

export async function renderMockup1080(imageOrOptions, maybeOptions) {
  let image = imageOrOptions;
  let opts = maybeOptions;
  if (!maybeOptions && (imageOrOptions?.image || imageOrOptions?.composition || imageOrOptions?.productType)) {
    opts = imageOrOptions || {};
    image = opts?.composition?.canvas || opts?.composition?.image || opts?.image;
  }

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('2d context unavailable');

  if (!image) {
    const emptyBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return emptyBlob || new Blob([], { type: 'image/png' });
  }

  const options = opts || {};
  const drawSource = options?.composition?.canvas || options?.composition?.image || image;
  let drawable = drawSource;

  const anySource = drawSource || {};
  const bitmapCandidate = drawSource || image;
  if (typeof createImageBitmap === 'function' && bitmapCandidate && !('close' in bitmapCandidate)) {
    try {
      drawable = await createImageBitmap(bitmapCandidate);
    } catch (err) {
      drawable = drawSource;
    }
  }
  const fallbackWidth = Number(anySource.width || anySource.naturalWidth || anySource.videoWidth || 0);
  const fallbackHeight = Number(anySource.height || anySource.naturalHeight || anySource.videoHeight || 0);

  const placement = getMockupPadRect1080(options, fallbackWidth, fallbackHeight);

  if (!placement) {
    console.warn('[renderMockup1080] placement_failed', { fallbackWidth, fallbackHeight });
  }

  const abortWithEmpty = async () => {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return blob || new Blob([], { type: 'image/png' });
  };

  const { x, y, targetW, targetH } = placement || {};
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(targetW) || !Number.isFinite(targetH)) {
    return await abortWithEmpty();
  }

  drawMockupComposite(ctx, drawable, placement, options);

  if (drawable && typeof drawable.close === 'function') {
    try {
      drawable.close();
    } catch (_) {}
  }

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return blob || new Blob([], { type: 'image/png' });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
