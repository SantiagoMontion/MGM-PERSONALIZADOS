/**
 * Normalizes a user-picked image for the editor.
 * Accepts PNG/JPEG/WebP directly; converts HEIC/HEIF (and other decodable types)
 * to JPEG via canvas when the browser can decode them.
 */

const DIRECT_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const CONVERT_EXT = /\.(heic|heif|webp|png|jpe?g|gif|bmp|tiff?)$/i;

export const UPLOAD_ACCEPT_ATTR =
  'image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif,.heic,.heif,.webp';

export function isLikelyImageUpload(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  const name = String(file.name || '').toLowerCase();
  return CONVERT_EXT.test(name);
}

function isHeicLike(file) {
  const type = String(file.type || '').toLowerCase();
  if (type.includes('heic') || type.includes('heif')) return true;
  return /\.(heic|heif)$/i.test(String(file.name || ''));
}

async function blobToJpegFile(source, baseName = 'upload') {
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    // Fallback: HTMLImageElement from object URL
    const url = URL.createObjectURL(source instanceof Blob ? source : new Blob([source]));
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('decode_failed'));
        el.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
      canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas_unavailable');
      ctx.drawImage(img, 0, 0);
      const jpegBlob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('encode_failed'))),
          'image/jpeg',
          0.92,
        );
      });
      const safeBase = String(baseName || 'upload').replace(/\.[^.]+$/, '') || 'upload';
      return new File([jpegBlob], `${safeBase}.jpg`, { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, bitmap.width || 1);
    canvas.height = Math.max(1, bitmap.height || 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const jpegBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('encode_failed'))),
        'image/jpeg',
        0.92,
      );
    });
    const safeBase = String(baseName || 'upload').replace(/\.[^.]+$/, '') || 'upload';
    return new File([jpegBlob], `${safeBase}.jpg`, { type: 'image/jpeg' });
  } finally {
    try {
      bitmap?.close?.();
    } catch {
      // noop
    }
  }
}

/**
 * @param {File} file
 * @returns {Promise<{ file: File, converted: boolean }>}
 */
export async function normalizeUploadImageFile(file) {
  if (!file) {
    throw new Error('No se seleccionó ningún archivo.');
  }
  if (!isLikelyImageUpload(file)) {
    throw new Error('Solo se permiten imágenes (PNG, JPG, WebP o HEIC).');
  }

  const type = String(file.type || '').toLowerCase();
  if (DIRECT_MIME.has(type) && !isHeicLike(file)) {
    return { file, converted: false };
  }

  // HEIC/HEIF or unknown image/* — try decode → JPEG
  try {
    const converted = await blobToJpegFile(file, file.name || 'upload');
    return { file: converted, converted: true };
  } catch {
    if (isHeicLike(file)) {
      throw new Error(
        'No pudimos leer esta foto HEIC. En el iPhone: Ajustes → Cámara → Formatos → "Más compatible", o exportala como JPG.',
      );
    }
    throw new Error('No pudimos leer esta imagen. Probá con PNG o JPG.');
  }
}
