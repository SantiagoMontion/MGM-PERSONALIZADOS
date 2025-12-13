import { PDFDocument } from 'pdf-lib';
import { bytesToMB, formatHeavyImageToastMessage } from './imageLimits.js';
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
    const actualMb = bytesToMB(masterSize);
    console.warn('[guard:file_too_heavy]', { maxMB: MAX_IMAGE_MB, actualMB: actualMb });
    window?.toast?.error?.(formatHeavyImageToastMessage(actualMb, MAX_IMAGE_MB), { duration: 6000 });
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
  return pdfBytes;
}
