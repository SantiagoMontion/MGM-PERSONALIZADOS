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
    dpi = 300,
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
  const resolvedWidthPx = Number.isFinite(widthPx) && widthPx > 0 ? Math.round(widthPx) : intrinsicWidth;
  const resolvedHeightPx = Number.isFinite(heightPx) && heightPx > 0 ? Math.round(heightPx) : intrinsicHeight;
  const pxToMm = (px) => {
    if (!Number.isFinite(px) || !px) return 0;
    const safeDpi = Number.isFinite(dpi) && dpi > 0 ? dpi : 300;
    return (px / safeDpi) * 25.4;
  };
  const resolvedWidthMm = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : pxToMm(resolvedWidthPx);
  const resolvedHeightMm = Number.isFinite(heightMm) && heightMm > 0 ? heightMm : pxToMm(resolvedHeightPx);
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
