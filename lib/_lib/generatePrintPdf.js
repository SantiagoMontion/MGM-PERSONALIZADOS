import { PDFDocument } from 'pdf-lib';
import { detectImageMime } from './imageToPdf.js';
import fetchOriginalAsset from './uploads.js';
import logger from './logger.js';
import { makeErr } from './errors.js';

const MM_TO_POINT = 72 / 25.4;
const DEFAULT_MARGIN_MM = 20;

function normalizeMarginMm(value) {
  if (value === null || value === undefined) return DEFAULT_MARGIN_MM;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_MARGIN_MM;
  return numeric;
}

function mmToPoints(valueMm, code = 'invalid_dimension') {
  const numeric = Number(valueMm);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return numeric * MM_TO_POINT;
}

function resolveSizeMm({ sizeMm, widthCm, heightCm }) {
  if (sizeMm && typeof sizeMm === 'object') {
    const w = Number(sizeMm.w ?? sizeMm.width ?? sizeMm.widthMm ?? sizeMm.width_mm);
    const h = Number(sizeMm.h ?? sizeMm.height ?? sizeMm.heightMm ?? sizeMm.height_mm);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { widthMm: w, heightMm: h };
    }
  }
  const widthMm = Number(widthCm) * 10;
  const heightMm = Number(heightCm) * 10;
  if (!Number.isFinite(widthMm) || widthMm <= 0) {
    const error = new Error('invalid_width_cm');
    error.code = 'invalid_width_cm';
    throw error;
  }
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    const error = new Error('invalid_height_cm');
    error.code = 'invalid_height_cm';
    throw error;
  }
  return { widthMm, heightMm };
}

function computeCropOffsets({
  drawX,
  drawY,
  drawWidthPt,
  drawHeightPt,
  areaX,
  areaY,
  areaWidthPt,
  areaHeightPt,
  scale,
}) {
  const imageRight = drawX + drawWidthPt;
  const imageTop = drawY + drawHeightPt;
  const areaRight = areaX + areaWidthPt;
  const areaTop = areaY + areaHeightPt;

  const cropLeftPt = Math.max(0, areaX - drawX);
  const cropBottomPt = Math.max(0, areaY - drawY);
  const cropRightPt = Math.max(0, imageRight - areaRight);
  const cropTopPt = Math.max(0, imageTop - areaTop);

  return {
    leftPx: cropLeftPt / scale,
    bottomPx: cropBottomPt / scale,
    rightPx: cropRightPt / scale,
    topPx: cropTopPt / scale,
  };
}

export async function generatePrintPdf({
  widthCm,
  heightCm,
  marginCm,
  sizeMm,
  marginMm,
  originalObjectKey,
  originalBucket,
  originalUrl,
  originalBuffer,
  supabase,
  rid,
  diagId,
}) {
  const { widthMm, heightMm } = resolveSizeMm({ sizeMm, widthCm, heightCm });
  const effectiveMarginMm = marginMm != null ? normalizeMarginMm(marginMm) : normalizeMarginMm(marginCm != null ? Number(marginCm) * 10 : undefined);

  const pageWidthMm = widthMm + effectiveMarginMm * 2;
  const pageHeightMm = heightMm + effectiveMarginMm * 2;

  const pageWidthPt = mmToPoints(pageWidthMm);
  const pageHeightPt = mmToPoints(pageHeightMm);
  const areaWidthPt = mmToPoints(widthMm);
  const areaHeightPt = mmToPoints(heightMm);
  const marginPt = mmToPoints(effectiveMarginMm);

  let sourceBuffer = originalBuffer;
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) {
    const asset = await fetchOriginalAsset({
      supabase,
      originalObjectKey,
      originalBucket,
      originalUrl,
      rid,
      diagId,
    });
    sourceBuffer = asset.buffer;
  }

  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) {
    throw makeErr('invalid_image_buffer', { code: 'invalid_image_buffer', rid: rid || null, diagId: diagId || null });
  }

  const detected = detectImageMime(sourceBuffer);
  if (!detected) {
    throw makeErr('unsupported_image_format', { rid: rid || null, diagId: diagId || null });
  }

  const pdfDoc = await PDFDocument.create();
  const embedded = detected.type === 'jpg'
    ? await pdfDoc.embedJpg(sourceBuffer)
    : await pdfDoc.embedPng(sourceBuffer);

  const scale = Math.min(areaWidthPt / embedded.width, areaHeightPt / embedded.height);
  const drawWidthPt = embedded.width * scale;
  const drawHeightPt = embedded.height * scale;
  const drawX = marginPt + (areaWidthPt - drawWidthPt) / 2;
  const drawY = marginPt + (areaHeightPt - drawHeightPt) / 2;

  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  page.drawImage(embedded, {
    x: drawX,
    y: drawY,
    width: drawWidthPt,
    height: drawHeightPt,
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  const pdfBuffer = Buffer.from(pdfBytes);

  if (sourceBuffer.length > 1_000_000 && pdfBuffer.length < 200_000) {
    throw makeErr('suspicious_output', {
      rid: rid || null,
      diagId: diagId || null,
      in: sourceBuffer.length,
      out: pdfBuffer.length,
    });
  }

  const cropOffsets = computeCropOffsets({
    drawX,
    drawY,
    drawWidthPt,
    drawHeightPt,
    areaX: marginPt,
    areaY: marginPt,
    areaWidthPt,
    areaHeightPt,
    scale,
  });

  const areaWidthPx = areaWidthPt / scale;
  const areaHeightPx = areaHeightPt / scale;

  logger.info('generate_print_pdf', {
    diagId: diagId || null,
    rid: rid || null,
    mime: detected.mime,
    srcBytes: sourceBuffer.length,
    outBytes: pdfBuffer.length,
  });

  return {
    buffer: pdfBuffer,
    info: {
      pageWidthCm: pageWidthMm / 10,
      pageHeightCm: pageHeightMm / 10,
      marginMm: effectiveMarginMm,
      marginCm: effectiveMarginMm / 10,
      area: {
        widthCm: widthMm / 10,
        heightCm: heightMm / 10,
        widthPx: areaWidthPx,
        heightPx: areaHeightPx,
      },
      artwork: {
        widthPx: embedded.width,
        heightPx: embedded.height,
        offsetLeftPx: cropOffsets.leftPx,
        offsetTopPx: cropOffsets.topPx,
        offsetRightPx: cropOffsets.rightPx,
        offsetBottomPx: cropOffsets.bottomPx,
      },
      source: {
        mime: detected.mime,
      },
    },
  };
}

export async function validatePrintPdf({
  buffer,
  expectedPageWidthCm,
  expectedPageHeightCm,
  expectedAreaWidthCm,
  expectedAreaHeightCm,
  marginCm = MARGIN_CM,
  toleranceMm = 1,
}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('pdf_buffer_empty');
    error.code = 'pdf_buffer_empty';
    throw error;
  }

  let doc;
  try {
    doc = await PDFDocument.load(buffer);
  } catch (err) {
    const error = new Error('pdf_parse_failed');
    error.code = 'pdf_parse_failed';
    error.cause = err;
    throw error;
  }

  const [page] = doc.getPages();
  if (!page) {
    const error = new Error('pdf_page_missing');
    error.code = 'pdf_page_missing';
    throw error;
  }

  const { width: pageWidthPt, height: pageHeightPt } = page.getSize();
  const measuredPageWidthCm = pageWidthPt / POINTS_PER_CM;
  const measuredPageHeightCm = pageHeightPt / POINTS_PER_CM;
  const measuredAreaWidthCm = measuredPageWidthCm - marginCm * 2;
  const measuredAreaHeightCm = measuredPageHeightCm - marginCm * 2;

  const expectedPageWidth = Number(expectedPageWidthCm);
  const expectedPageHeight = Number(expectedPageHeightCm);
  const expectedAreaWidth = Number(expectedAreaWidthCm);
  const expectedAreaHeight = Number(expectedAreaHeightCm);

  const deltaPageWidthMm = Math.abs(measuredPageWidthCm - expectedPageWidth) * 10;
  const deltaPageHeightMm = Math.abs(measuredPageHeightCm - expectedPageHeight) * 10;
  const deltaAreaWidthMm = Math.abs(measuredAreaWidthCm - expectedAreaWidth) * 10;
  const deltaAreaHeightMm = Math.abs(measuredAreaHeightCm - expectedAreaHeight) * 10;

  const ok = [
    deltaPageWidthMm,
    deltaPageHeightMm,
    deltaAreaWidthMm,
    deltaAreaHeightMm,
  ].every((delta) => delta <= toleranceMm + 1e-6);

  return {
    ok,
    toleranceMm,
    expected: {
      pageWidthCm: expectedPageWidth,
      pageHeightCm: expectedPageHeight,
      areaWidthCm: expectedAreaWidth,
      areaHeightCm: expectedAreaHeight,
      marginCm,
    },
    measured: {
      pageWidthCm: measuredPageWidthCm,
      pageHeightCm: measuredPageHeightCm,
      areaWidthCm: measuredAreaWidthCm,
      areaHeightCm: measuredAreaHeightCm,
    },
    deltasMm: {
      pageWidth: deltaPageWidthMm,
      pageHeight: deltaPageHeightMm,
      areaWidth: deltaAreaWidthMm,
      areaHeight: deltaAreaHeightMm,
    },
  };
}

export default generatePrintPdf;
