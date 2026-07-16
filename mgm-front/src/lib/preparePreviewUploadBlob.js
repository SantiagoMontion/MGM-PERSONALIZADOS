/** Vercel Function body max ~4.5MB; dataURL base64 inflates ~4/3. Keep binary under this. */
const PREVIEW_UPLOAD_MAX_BYTES = Math.floor(3.2 * 1024 * 1024);

/**
 * Prepares a mockup blob for POST /api/preview/upload.
 * Mantiene PNG con fondo transparente (alpha). Solo re-encoda/escala si supera el tope
 * de Vercel (antes se forzaba JPEG + blanco y se perdía la transparencia).
 * No toca el master/print de alta resolución.
 */
export async function preparePreviewUploadBlob(blob) {
  if (!blob) return null;

  const type = String(blob.type || '').toLowerCase();
  const isPng = type.includes('png') || (!type && blob.size > 0);
  if (isPng && blob.size > 0 && blob.size <= PREVIEW_UPLOAD_MAX_BYTES) {
    return blob;
  }

  const encodePngAtScale = async (source, scale) => {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(source);
      const srcW = Math.max(1, bitmap.width || 0);
      const srcH = Math.max(1, bitmap.height || 0);
      const width = Math.max(1, Math.round(srcW * scale));
      const height = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return null;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });
    } catch {
      return null;
    } finally {
      try {
        bitmap?.close?.();
      } catch {
        // noop
      }
    }
  };

  const scales = [1, 0.85, 0.7, 0.55, 0.45];
  let best = null;
  for (const scale of scales) {
    const png = await encodePngAtScale(blob, scale);
    if (!png || !(png.size > 0)) continue;
    if (png.size <= PREVIEW_UPLOAD_MAX_BYTES) {
      return png;
    }
    if (!best || png.size < best.size) {
      best = png;
    }
  }

  if (best && best.size > 0 && best.size < blob.size) {
    return best;
  }
  return blob;
}
