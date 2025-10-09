import { PDFDocument } from 'pdf-lib';

const MM_TO_PT = 72 / 25.4;

function mmToPt(mm) {
  if (!Number.isFinite(mm)) return 0;
  return mm * MM_TO_PT;
}

export async function buildPdfFromMaster(masterBlob, options = {}) {
  if (!masterBlob || typeof masterBlob.arrayBuffer !== 'function') {
    throw new Error('master_blob_required');
  }

  const {
    bleedMm = 20,
    widthPx,
    heightPx,
    widthMm,
    heightMm,
    maxBytes = Infinity,
  } = options || {};

  const bytes = await masterBlob.arrayBuffer();
  const pdfDoc = await PDFDocument.create();

  let embedded;
  try {
    embedded = await pdfDoc.embedPng(bytes);
  } catch {
    embedded = await pdfDoc.embedJpg(bytes);
  }

  const intrinsicWidth = embedded.width;
  const intrinsicHeight = embedded.height;
  const resolvedWidthPx = typeof widthPx === 'number' && widthPx > 0 ? widthPx : intrinsicWidth;
  const resolvedHeightPx = typeof heightPx === 'number' && heightPx > 0 ? heightPx : intrinsicHeight;
  const resolvedWidthMm = typeof widthMm === 'number' && widthMm > 0
    ? widthMm
    : resolvedWidthPx;
  const resolvedHeightMm = typeof heightMm === 'number' && heightMm > 0
    ? heightMm
    : resolvedHeightPx;

  const bleedTotalMm = Math.max(0, Number(bleedMm) || 0);
  const bleedEachMm = bleedTotalMm / 2;

  const pageWidthPt = mmToPt(resolvedWidthMm + bleedEachMm * 2);
  const pageHeightPt = mmToPt(resolvedHeightMm + bleedEachMm * 2);
  const imageWidthPt = mmToPt(resolvedWidthMm);
  const imageHeightPt = mmToPt(resolvedHeightMm);
  const offsetX = mmToPt(bleedEachMm);
  const offsetY = mmToPt(bleedEachMm);

  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  page.drawImage(embedded, {
    x: offsetX,
    y: offsetY,
    width: imageWidthPt,
    height: imageHeightPt,
  });
  let pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  if (!(Number.isFinite(maxBytes) && maxBytes > 0) || pdfBytes.length <= maxBytes) {
    return pdfBytes;
  }

  async function blobToJpegBytes(blob, quality) {
    const createBitmap = async () => {
      if (typeof createImageBitmap === 'function') {
        return createImageBitmap(blob);
      }
      const objectUrl = URL.createObjectURL(blob);
      try {
        return await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = (err) => reject(err || new Error('image_load_failed'));
          img.src = objectUrl;
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    const bitmap = await createBitmap();
    const width = bitmap?.naturalWidth || bitmap?.width || 0;
    const height = bitmap?.naturalHeight || bitmap?.height || 0;
    if (!width || !height) {
      throw new Error('invalid_image_dimensions');
    }

    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!canvas) {
      throw new Error('canvas_unavailable');
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas_context_unavailable');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }

    if (typeof canvas.convertToBlob === 'function') {
      const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      return new Uint8Array(await jpegBlob.arrayBuffer());
    }

    const jpegBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('jpeg_conversion_failed'));
        }
      }, 'image/jpeg', quality);
    });
    return new Uint8Array(await jpegBlob.arrayBuffer());
  }

  const qualities = [0.92, 0.85];
  for (const quality of qualities) {
    const jpegBytes = await blobToJpegBytes(masterBlob, quality);
    const jpegDoc = await PDFDocument.create();
    const jpegImage = await jpegDoc.embedJpg(jpegBytes);
    const jpegPage = jpegDoc.addPage([pageWidthPt, pageHeightPt]);
    jpegPage.drawImage(jpegImage, {
      x: offsetX,
      y: offsetY,
      width: imageWidthPt,
      height: imageHeightPt,
    });
    pdfBytes = await jpegDoc.save({ useObjectStreams: false });
    if (pdfBytes.length <= maxBytes) {
      return pdfBytes;
    }
  }

  return pdfBytes;
}
