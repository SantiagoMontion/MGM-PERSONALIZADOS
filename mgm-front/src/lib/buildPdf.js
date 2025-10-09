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

  return pdfDoc.save({ useObjectStreams: false });
}
