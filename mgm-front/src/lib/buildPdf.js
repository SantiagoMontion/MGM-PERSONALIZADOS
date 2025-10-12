import { PDFDocument } from 'pdf-lib';
import { MAX_IMAGE_MB, MAX_IMAGE_BYTES } from './imageSizeLimit.js';

const MM_TO_PT = 72 / 25.4;

function mmToPt(mm) {
  if (!Number.isFinite(mm)) return 0;
  return mm * MM_TO_PT;
}

export async function buildPdfFromMaster(masterBlob, options = {}) {
  if (!masterBlob || typeof masterBlob.arrayBuffer !== 'function') {
    throw new Error('master_blob_required');
  }

  const masterSize = Number(masterBlob?.size);
  if (Number.isFinite(masterSize) && masterSize > MAX_IMAGE_BYTES) {
    window?.toast?.error?.(`La imagen supera ${MAX_IMAGE_MB} MB. No podemos procesarla.`);
    const err = new Error('image_too_heavy');
    err.reason = 'image_too_heavy';
    throw err;
  }

  const {
    bleedMm = 20,
    widthPx,
    heightPx,
    widthMm,
    heightMm,
    mime,
    maxBytes = Infinity,
    dpi = 300,
  } = options || {};

  performance.mark?.('pdf_bytes_start');
  const bytes = await masterBlob.arrayBuffer();
  performance.mark?.('pdf_bytes_end');
  const pdfDoc = await PDFDocument.create();

  performance.mark?.('pdf_embed_start');
  const lowerMime = (mime || masterBlob.type || '').toLowerCase();
  let embedded;
  if (lowerMime.includes('jpeg') || lowerMime.includes('jpg')) {
    embedded = await pdfDoc.embedJpg(bytes);
  } else if (lowerMime.includes('png')) {
    embedded = await pdfDoc.embedPng(bytes);
  } else {
    try {
      embedded = await pdfDoc.embedPng(bytes);
    } catch {
      embedded = await pdfDoc.embedJpg(bytes);
    }
  }
  performance.mark?.('pdf_embed_end');

  const intrinsicWidth = embedded.width;
  const intrinsicHeight = embedded.height;
  const resolvedWidthPx = Number.isFinite(widthPx) && widthPx > 0 ? Math.round(widthPx) : intrinsicWidth;
  const resolvedHeightPx = Number.isFinite(heightPx) && heightPx > 0 ? Math.round(heightPx) : intrinsicHeight;
  const safeDpi = Number.isFinite(dpi) && dpi > 0 ? dpi : 300;
  const pxToMm = (px) => (px / safeDpi) * 25.4;
  const resolvedWidthMm = Number.isFinite(widthMm) && widthMm > 0
    ? widthMm
    : pxToMm(resolvedWidthPx);
  const resolvedHeightMm = Number.isFinite(heightMm) && heightMm > 0
    ? heightMm
    : pxToMm(resolvedHeightPx);

  const bleedTotalMm = Math.max(0, Number(bleedMm) || 0);
  const bleedEachMm = bleedTotalMm / 2;

  const pageWidthPt = mmToPt(resolvedWidthMm + bleedEachMm * 2);
  const pageHeightPt = mmToPt(resolvedHeightMm + bleedEachMm * 2);
  const imageWidthPt = pageWidthPt;
  const imageHeightPt = pageHeightPt;
  const offsetX = 0;
  const offsetY = 0;

  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  // cubrir la página completa (incluye bleed) sin bordes blancos
  page.drawImage(embedded, {
    x: offsetX,
    y: offsetY,
    width: imageWidthPt,
    height: imageHeightPt,
  });
  // Aprovechar object streams (PDF 1.5+) reduce tamaño/tiempo de serialización
  performance.mark?.('pdf_save_start');
  let pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  performance.mark?.('pdf_save_end');
  try {
    const measure = (name, start, end) => {
      const result = performance.measure?.(name, start, end);
      return result?.duration ?? 0;
    };
    const fmt = (value) => (Number.isFinite(value) ? Number(value.toFixed(2)) : value);
    console.debug?.('[perf.pdf]', {
      bytes: fmt(measure('pdf_bytes', 'pdf_bytes_start', 'pdf_bytes_end')),
      embed: fmt(measure('pdf_embed', 'pdf_embed_start', 'pdf_embed_end')),
      save: fmt(measure('pdf_save', 'pdf_save_start', 'pdf_save_end')),
    });
  } catch {}
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
    // fallback JPEG también debe ocupar todo el lienzo
    jpegPage.drawImage(jpegImage, {
      x: offsetX,
      y: offsetY,
      width: imageWidthPt,
      height: imageHeightPt,
    });
    pdfBytes = await jpegDoc.save({ useObjectStreams: true });
    if (pdfBytes.length <= maxBytes) {
      return pdfBytes;
    }
  }

  return pdfBytes;
}
