import { PDFDocument } from 'pdf-lib';
import { imageBufferToPdfLossless } from './imageToPdf.js';
import fetchOriginalAsset from './uploads.js';
import logger from './logger.js';

const CM_PER_INCH = 2.54;
const MARGIN_CM = 2;
const POINTS_PER_CM = 72 / CM_PER_INCH;

function normalizeDimension(value, code) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return numeric;
}

function normalizeMargin(value) {
  if (value === null || value === undefined) {
    return MARGIN_CM;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return MARGIN_CM;
  }
  return numeric;
}

function cmToPoints(valueCm) {
  const numeric = Number(valueCm);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    const error = new Error('invalid_dimension');
    error.code = 'invalid_dimension';
    throw error;
  }
  return numeric * POINTS_PER_CM;
}

function cmToMm(valueCm) {
  const numeric = Number(valueCm);
  if (!Number.isFinite(numeric)) return null;
  return numeric * 10;
}

export async function generatePrintPdf({
  widthCm,
  heightCm,
  marginCm,
  originalObjectKey,
  originalBucket,
  originalUrl,
  originalBuffer,
  supabase,
  rid,
  diagId,
}) {
  const areaWidthCm = normalizeDimension(widthCm, 'invalid_width_cm');
  const areaHeightCm = normalizeDimension(heightCm, 'invalid_height_cm');
  const effectiveMarginCm = normalizeMargin(marginCm);

  const widthMm = cmToMm(areaWidthCm);
  const heightMm = cmToMm(areaHeightCm);
  const marginMm = cmToMm(effectiveMarginCm) || 0;
  const targetWidthMm = widthMm != null ? widthMm + marginMm * 2 : null;
  const targetHeightMm = heightMm != null ? heightMm + marginMm * 2 : null;

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
    const error = new Error('invalid_image_buffer');
    error.code = 'invalid_image_buffer';
    throw error;
  }

  const pdfResult = await imageBufferToPdfLossless({
    buffer: sourceBuffer,
    targetWidthMm,
    targetHeightMm,
    rid,
    diagId,
  });

  const pageWidthCm = targetWidthMm != null ? targetWidthMm / 10 : null;
  const pageHeightCm = targetHeightMm != null ? targetHeightMm / 10 : null;

  logger.info('generate_print_pdf', {
    diagId: diagId || null,
    rid: rid || null,
    mime: pdfResult?.info?.mime || null,
    srcBytes: sourceBuffer.length,
    outBytes: pdfResult?.pdfBuffer?.length || 0,
  });

  return {
    buffer: pdfResult.pdfBuffer,
    info: {
      pageWidthCm,
      pageHeightCm,
      marginCm: effectiveMarginCm,
      area: {
        widthCm: areaWidthCm,
        heightCm: areaHeightCm,
        widthPx: pdfResult.info.widthPx,
        heightPx: pdfResult.info.heightPx,
      },
      artwork: {
        widthPx: pdfResult.info.widthPx,
        heightPx: pdfResult.info.heightPx,
        offsetLeftPx: 0,
        offsetTopPx: 0,
      },
      source: {
        mime: pdfResult.info.mime,
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
