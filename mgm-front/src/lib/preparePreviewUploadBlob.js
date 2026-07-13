/** Vercel Function body max ~4.5MB; dataURL base64 inflates ~4/3. Keep binary under this. */
const PREVIEW_UPLOAD_MAX_BYTES = Math.floor(3.2 * 1024 * 1024);

/**
 * Prepares a mockup blob for POST /api/preview/upload.
 * Re-encodes as JPEG so 2048² PNGs no disparen 413 (el browser lo reporta como CORS).
 * No toca el master/print de alta resolución.
 */
export async function preparePreviewUploadBlob(blob, { quality = 0.82 } = {}) {
  if (!blob) return null;

  const encodeJpeg = async (source, q) => {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(source);
      const width = Math.max(1, bitmap.width || 0);
      const height = Math.max(1, bitmap.height || 0);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0);
      return await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', q);
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

  const type = String(blob.type || '').toLowerCase();
  const alreadyCompact = (type.includes('jpeg') || type.includes('jpg') || type.includes('webp'))
    && blob.size <= PREVIEW_UPLOAD_MAX_BYTES;
  if (alreadyCompact) return blob;

  let jpeg = await encodeJpeg(blob, quality);
  if (jpeg && jpeg.size > PREVIEW_UPLOAD_MAX_BYTES) {
    jpeg = await encodeJpeg(blob, 0.65);
  }
  if (jpeg && jpeg.size > 0 && jpeg.size <= PREVIEW_UPLOAD_MAX_BYTES) {
    return jpeg;
  }
  if (jpeg && jpeg.size > 0 && jpeg.size < blob.size) {
    return jpeg;
  }
  return blob;
}
