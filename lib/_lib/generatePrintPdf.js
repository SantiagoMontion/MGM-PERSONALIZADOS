import sharp from 'sharp';
import {
  PDFDocument,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
} from 'pdf-lib';
import logger from './logger.js';

const CM_PER_INCH = 2.54;
export const DEFAULT_DPI = 300;
const MARGIN_CM = 2;
const POINTS_PER_CM = 72 / CM_PER_INCH;

const ENV_STRATEGY = String(process.env.PDF_IMAGE_STRATEGY || 'lossless').trim().toLowerCase();
const STRATEGY = ENV_STRATEGY === 'contain' ? 'contain' : 'lossless';
const ENV_DPI = Number.parseInt(process.env.PDF_TARGET_DPI || '', 10);
const ENV_DPI_VALID = Number.isFinite(ENV_DPI) && ENV_DPI >= 72 ? ENV_DPI : null;

function cmToPixels(valueCm, dpi) {
  const numeric = Number(valueCm);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    const error = new Error('invalid_dimension');
    error.code = 'invalid_dimension';
    throw error;
  }
  const pixelsPerCm = dpi / CM_PER_INCH;
  return Math.max(1, Math.round(numeric * pixelsPerCm));
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

function normalizeColor(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '#ffffff';
  const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!hexMatch) return '#ffffff';
  const [, value] = hexMatch;
  if (value.length === 3) {
    return `#${value.split('').map((ch) => ch + ch).join('')}`;
  }
  return `#${value}`;
}

function hexToRgb(hexColor) {
  const normalized = normalizeColor(hexColor);
  const value = normalized.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

function resolveEffectiveDpi(metadata) {
  const candidates = [
    metadata?.density,
    metadata?.xDensity,
    metadata?.yDensity,
    metadata?.xResolution,
    metadata?.yResolution,
    metadata?.resolution,
  ]
    .map((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    })
    .filter((value) => value != null);
  const metadataDpi = candidates.length ? Math.max(...candidates) : null;
  const targetDpi = ENV_DPI_VALID || DEFAULT_DPI;
  if (metadataDpi && metadataDpi > targetDpi) return metadataDpi;
  return targetDpi;
}

function resolveImageStrategy() {
  return STRATEGY;
}

function selectEmbedKind(format) {
  if (!format) return 'jpeg';
  const normalized = String(format).trim().toLowerCase();
  if (normalized === 'jpeg' || normalized === 'jpg') return 'jpeg';
  if (normalized === 'png') return 'png';
  return null;
}

function buildClipOperators({ page, x, y, width, height }) {
  page.pushOperators(
    pushGraphicsState(),
    moveTo(x, y),
    lineTo(x + width, y),
    lineTo(x + width, y + height),
    lineTo(x, y + height),
    closePath(),
    clip(),
    endPath(),
  );
}

function releaseClip(page) {
  page.pushOperators(popGraphicsState());
}

async function readMetadata(buffer) {
  try {
    return await sharp(buffer, { failOnError: false }).metadata();
  } catch (err) {
    const error = new Error('image_metadata_failed');
    error.code = 'image_metadata_failed';
    error.cause = err;
    throw error;
  }
}

export async function generatePrintPdf({
  widthCm,
  heightCm,
  backgroundColor,
  imageBuffer,
  diagId,
}) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    const error = new Error('invalid_image_buffer');
    error.code = 'invalid_image_buffer';
    throw error;
  }

  const areaWidthCm = Number(widthCm);
  const areaHeightCm = Number(heightCm);
  if (!Number.isFinite(areaWidthCm) || areaWidthCm <= 0) {
    const error = new Error('invalid_width_cm');
    error.code = 'invalid_width_cm';
    throw error;
  }
  if (!Number.isFinite(areaHeightCm) || areaHeightCm <= 0) {
    const error = new Error('invalid_height_cm');
    error.code = 'invalid_height_cm';
    throw error;
  }

  const pageWidthCm = areaWidthCm + MARGIN_CM * 2;
  const pageHeightCm = areaHeightCm + MARGIN_CM * 2;
  const normalizedColor = normalizeColor(backgroundColor);
  const { r, g, b } = hexToRgb(normalizedColor);

  const metadata = await readMetadata(imageBuffer);
  const effectiveDpi = resolveEffectiveDpi(metadata);
  const areaWidthPx = cmToPixels(areaWidthCm, effectiveDpi);
  const areaHeightPx = cmToPixels(areaHeightCm, effectiveDpi);

  const embedKind = selectEmbedKind(metadata?.format) || 'jpeg';
  let embedBuffer = imageBuffer;
  let embedFormat = embedKind;
  let convertedFrom = null;

  if (embedKind !== 'jpeg' && embedKind !== 'png') {
    convertedFrom = metadata?.format || 'unknown';
    embedFormat = 'png';
    embedBuffer = await sharp(imageBuffer, { failOnError: false })
      .png({ compressionLevel: 0, progressive: false, adaptiveFiltering: false })
      .toBuffer();
  }

  const pdfDoc = await PDFDocument.create();
  const pageWidthPt = cmToPoints(pageWidthCm);
  const pageHeightPt = cmToPoints(pageHeightCm);
  const marginPt = cmToPoints(MARGIN_CM);
  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidthPt,
    height: pageHeightPt,
    color: rgb(r / 255, g / 255, b / 255),
  });

  const embedImage = embedFormat === 'png'
    ? await pdfDoc.embedPng(embedBuffer)
    : await pdfDoc.embedJpg(embedBuffer);

  const naturalWidthPt = embedImage.width;
  const naturalHeightPt = embedImage.height;
  if (!naturalWidthPt || !naturalHeightPt) {
    const error = new Error('image_dimensions_invalid');
    error.code = 'image_dimensions_invalid';
    throw error;
  }

  const areaWidthPt = cmToPoints(areaWidthCm);
  const areaHeightPt = cmToPoints(areaHeightCm);
  const strategy = resolveImageStrategy();
  const scale = strategy === 'contain'
    ? Math.min(areaWidthPt / naturalWidthPt, areaHeightPt / naturalHeightPt)
    : Math.max(areaWidthPt / naturalWidthPt, areaHeightPt / naturalHeightPt);

  const drawWidthPt = naturalWidthPt * scale;
  const drawHeightPt = naturalHeightPt * scale;
  const drawX = marginPt + (areaWidthPt - drawWidthPt) / 2;
  const drawY = marginPt + (areaHeightPt - drawHeightPt) / 2;

  buildClipOperators({ page, x: marginPt, y: marginPt, width: areaWidthPt, height: areaHeightPt });
  page.drawImage(embedImage, {
    x: drawX,
    y: drawY,
    width: drawWidthPt,
    height: drawHeightPt,
    rotate: degrees(0),
  });
  releaseClip(page);

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  const pdfBuffer = Buffer.from(pdfBytes);

  logger.debug('pdf_generate_render', {
    diagId,
    strategy,
    dpi: effectiveDpi,
    imgFormat: embedFormat,
    imgBytes: embedBuffer.length,
    pdfBytes: pdfBuffer.length,
    convertedFrom,
  });

  return {
    buffer: pdfBuffer,
    info: {
      pageWidthCm,
      pageHeightCm,
      marginCm: MARGIN_CM,
      dpi: effectiveDpi,
      strategy,
      area: {
        widthCm: areaWidthCm,
        heightCm: areaHeightCm,
        widthPx: areaWidthPx,
        heightPx: areaHeightPx,
      },
      artwork: {
        widthPx: metadata?.width || null,
        heightPx: metadata?.height || null,
        offsetLeftPx: 0,
        offsetTopPx: 0,
        scale,
      },
      backgroundColor: normalizedColor,
      imageFormat: embedFormat,
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
