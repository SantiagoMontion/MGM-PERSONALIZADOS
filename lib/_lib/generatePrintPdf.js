import sharp from 'sharp';
import { PDFDocument, rgb } from 'pdf-lib';

const CM_PER_INCH = 2.54;
const DEFAULT_DPI = 300;
const MARGIN_CM = 2;
const POINTS_PER_CM = 72 / CM_PER_INCH;
const PIXELS_PER_CM = DEFAULT_DPI / CM_PER_INCH;

function cmToPixels(valueCm) {
  const numeric = Number(valueCm);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    const error = new Error('invalid_dimension');
    error.code = 'invalid_dimension';
    throw error;
  }
  return Math.max(1, Math.round(numeric * PIXELS_PER_CM));
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

export async function generatePrintPdf({
  widthCm,
  heightCm,
  backgroundColor,
  imageBuffer,
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

  const areaWidthPx = cmToPixels(areaWidthCm);
  const areaHeightPx = cmToPixels(areaHeightCm);

  const normalizedColor = normalizeColor(backgroundColor);
  const { r, g, b } = hexToRgb(normalizedColor);

  let artworkBuffer;
  let artworkMetadata;
  try {
    const pipeline = sharp(imageBuffer)
      .rotate()
      .resize({
        width: areaWidthPx,
        height: areaHeightPx,
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
        background: { r, g, b, alpha: 1 },
      })
      .toColourspace('srgb');
    artworkBuffer = await pipeline
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    artworkMetadata = await sharp(artworkBuffer).metadata();
  } catch (err) {
    const error = new Error('artwork_processing_failed');
    error.code = 'artwork_processing_failed';
    error.cause = err;
    throw error;
  }

  const artworkWidthPx = Math.min(areaWidthPx, artworkMetadata?.width || areaWidthPx);
  const artworkHeightPx = Math.min(areaHeightPx, artworkMetadata?.height || areaHeightPx);
  const offsetLeftPx = Math.max(0, Math.round((areaWidthPx - artworkWidthPx) / 2));
  const offsetTopPx = Math.max(0, Math.round((areaHeightPx - artworkHeightPx) / 2));

  let areaCompositeBuffer;
  try {
    areaCompositeBuffer = await sharp({
      create: {
        width: areaWidthPx,
        height: areaHeightPx,
        channels: 4,
        background: { r, g, b, alpha: 1 },
      },
    })
      .composite([
        {
          input: artworkBuffer,
          left: offsetLeftPx,
          top: offsetTopPx,
        },
      ])
      .toColourspace('srgb')
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } catch (err) {
    const error = new Error('area_composite_failed');
    error.code = 'area_composite_failed';
    error.cause = err;
    throw error;
  }

  let pdfBuffer;
  try {
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
    const embedded = await pdfDoc.embedPng(areaCompositeBuffer);
    const areaWidthPt = cmToPoints(areaWidthCm);
    const areaHeightPt = cmToPoints(areaHeightCm);
    page.drawImage(embedded, {
      x: marginPt,
      y: marginPt,
      width: areaWidthPt,
      height: areaHeightPt,
    });
    const uint8 = await pdfDoc.save();
    pdfBuffer = Buffer.from(uint8);
  } catch (err) {
    const error = new Error('pdf_generation_failed');
    error.code = 'pdf_generation_failed';
    error.cause = err;
    throw error;
  }

  return {
    buffer: pdfBuffer,
    info: {
      pageWidthCm,
      pageHeightCm,
      marginCm: MARGIN_CM,
      dpi: DEFAULT_DPI,
      area: {
        widthCm: areaWidthCm,
        heightCm: areaHeightCm,
        widthPx: areaWidthPx,
        heightPx: areaHeightPx,
      },
      artwork: {
        widthPx: artworkWidthPx,
        heightPx: artworkHeightPx,
        offsetLeftPx,
        offsetTopPx,
      },
      backgroundColor: normalizedColor,
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
