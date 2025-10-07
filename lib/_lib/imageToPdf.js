import sharp from "sharp";
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
} from "pdf-lib";
import logger from "./logger.js";

const DEFAULT_BACKGROUND = "#ffffff";
const CM_PER_INCH = 2.54;
const DEFAULT_DENSITY = 300;

const ENV_STRATEGY = String(process.env.PDF_IMAGE_STRATEGY || "lossless").trim().toLowerCase();
const STRATEGY = ENV_STRATEGY === "contain" ? "contain" : "lossless";
const ENV_DPI = Number.parseInt(process.env.PDF_TARGET_DPI || "", 10);
const ENV_DPI_VALID = Number.isFinite(ENV_DPI) && ENV_DPI >= 72 ? ENV_DPI : null;

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeBackground(background) {
  if (!background) return DEFAULT_BACKGROUND;
  const raw = String(background).trim();
  if (!raw) return DEFAULT_BACKGROUND;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match) return DEFAULT_BACKGROUND;
  const value = match[1];
  if (value.length === 3) {
    return `#${value.split('').map((ch) => ch + ch).join('')}`;
  }
  return `#${value}`;
}

function hexToRgb(hexColor) {
  const normalized = normalizeBackground(hexColor);
  const value = normalized.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

function cmToPoints(cm) {
  const numeric = toNumber(cm);
  if (!numeric || numeric <= 0) {
    const error = new Error('invalid_dimension');
    error.code = 'invalid_dimension';
    throw error;
  }
  return (numeric / CM_PER_INCH) * 72;
}

function cmToPixels(cm, dpi) {
  const numeric = toNumber(cm);
  if (!numeric || numeric <= 0) {
    const error = new Error('invalid_dimension');
    error.code = 'invalid_dimension';
    throw error;
  }
  const pixelsPerCm = dpi / CM_PER_INCH;
  return Math.max(1, Math.round(numeric * pixelsPerCm));
}

function resolveDensity(options, metadata) {
  const candidates = [];
  if (options?.density && Number.isFinite(options.density)) {
    candidates.push(Math.max(72, Number(options.density)));
  }
  const metadataDensities = [
    metadata?.density,
    metadata?.xDensity,
    metadata?.yDensity,
    metadata?.resolution,
    metadata?.xResolution,
    metadata?.yResolution,
  ].map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }).filter((value) => value != null);
  if (metadataDensities.length) {
    candidates.push(Math.max(...metadataDensities));
  }
  const baseWidthCm = toNumber(options?.widthCm);
  const baseHeightCm = toNumber(options?.heightCm);
  const bleedValueCm = Math.max(0, toNumber(options?.bleedCm, 0));
  const targetWidthCm = baseWidthCm ? baseWidthCm + bleedValueCm * 2 : baseWidthCm;
  const targetHeightCm = baseHeightCm ? baseHeightCm + bleedValueCm * 2 : baseHeightCm;
  const imageWidthPx = metadata?.width || null;
  const imageHeightPx = metadata?.height || null;
  const computeDensityCandidate = (pixels, cm) => {
    if (!pixels || !cm || cm <= 0) return null;
    const inches = cm / CM_PER_INCH;
    if (inches <= 0) return null;
    return pixels / inches;
  };
  if (imageWidthPx) {
    if (baseWidthCm) candidates.push(computeDensityCandidate(imageWidthPx, baseWidthCm));
    if (targetWidthCm) candidates.push(computeDensityCandidate(imageWidthPx, targetWidthCm));
  }
  if (imageHeightPx) {
    if (baseHeightCm) candidates.push(computeDensityCandidate(imageHeightPx, baseHeightCm));
    if (targetHeightCm) candidates.push(computeDensityCandidate(imageHeightPx, targetHeightCm));
  }
  if (ENV_DPI_VALID) candidates.push(ENV_DPI_VALID);
  candidates.push(DEFAULT_DENSITY);
  const filtered = candidates.filter((value) => Number.isFinite(value) && value > 0);
  return filtered.length ? Math.max(...filtered) : DEFAULT_DENSITY;
}

function selectEmbedKind(format) {
  if (!format) return 'jpeg';
  const normalized = String(format).trim().toLowerCase();
  if (normalized === 'jpeg' || normalized === 'jpg') return 'jpeg';
  if (normalized === 'png') return 'png';
  return null;
}

function buildClip(page, x, y, width, height) {
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

export async function imageBufferToPdf({
  buffer,
  density,
  background,
  bleedCm = 0,
  widthCm,
  heightCm,
  diagId,
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('invalid_image_buffer');
    error.code = 'invalid_image_buffer';
    throw error;
  }

  let metadata;
  try {
    metadata = await sharp(buffer, { failOnError: false }).metadata();
  } catch (err) {
    const error = new Error('image_metadata_failed');
    error.code = 'image_metadata_failed';
    error.cause = err;
    throw error;
  }

  const effectiveDensity = resolveDensity({ density, widthCm, heightCm, bleedCm }, metadata);
  const baseWidthCmInput = toNumber(widthCm);
  const baseHeightCmInput = toNumber(heightCm);
  const bleedValueCm = Math.max(0, toNumber(bleedCm, 0));

  const imageWidthPx = metadata?.width || null;
  const imageHeightPx = metadata?.height || null;

  const inferredWidthCm = imageWidthPx
    ? (imageWidthPx / effectiveDensity) * CM_PER_INCH
    : null;
  const inferredHeightCm = imageHeightPx
    ? (imageHeightPx / effectiveDensity) * CM_PER_INCH
    : null;

  const contentWidthCm = baseWidthCmInput ?? inferredWidthCm ?? 1;
  const contentHeightCm = baseHeightCmInput ?? inferredHeightCm ?? 1;
  const pageWidthCm = contentWidthCm + bleedValueCm * 2;
  const pageHeightCm = contentHeightCm + bleedValueCm * 2;

  const pageWidthPt = cmToPoints(pageWidthCm);
  const pageHeightPt = cmToPoints(pageHeightCm);
  const contentWidthPt = cmToPoints(contentWidthCm);
  const contentHeightPt = cmToPoints(contentHeightCm);
  const bleedPt = bleedValueCm > 0 ? cmToPoints(bleedValueCm) : 0;

  const normalizedBackground = normalizeBackground(background);
  const { r, g, b } = hexToRgb(normalizedBackground);

  const embedKind = selectEmbedKind(metadata?.format) || 'jpeg';
  let embedBuffer = buffer;
  let embedFormat = embedKind;
  let convertedFrom = null;

  if (embedKind !== 'jpeg' && embedKind !== 'png') {
    convertedFrom = metadata?.format || 'unknown';
    embedFormat = 'png';
    embedBuffer = await sharp(buffer, { failOnError: false }).png({ compressionLevel: 0, progressive: false, adaptiveFiltering: false }).toBuffer();
  }

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidthPt,
    height: pageHeightPt,
    color: rgb(r / 255, g / 255, b / 255),
  });

  const embedded = embedFormat === 'png'
    ? await pdfDoc.embedPng(embedBuffer)
    : await pdfDoc.embedJpg(embedBuffer);

  const naturalWidthPt = embedded.width;
  const naturalHeightPt = embedded.height;
  if (!naturalWidthPt || !naturalHeightPt) {
    const error = new Error('image_dimensions_invalid');
    error.code = 'image_dimensions_invalid';
    throw error;
  }
  const strategy = STRATEGY;
  const scale = strategy === 'contain'
    ? Math.min(contentWidthPt / naturalWidthPt, contentHeightPt / naturalHeightPt)
    : Math.max(contentWidthPt / naturalWidthPt, contentHeightPt / naturalHeightPt);

  const drawWidth = naturalWidthPt * scale;
  const drawHeight = naturalHeightPt * scale;
  const drawX = bleedPt + (contentWidthPt - drawWidth) / 2;
  const drawY = bleedPt + (contentHeightPt - drawHeight) / 2;

  buildClip(page, bleedPt, bleedPt, contentWidthPt, contentHeightPt);
  page.drawImage(embedded, {
    x: drawX,
    y: drawY,
    width: drawWidth,
    height: drawHeight,
    rotate: degrees(0),
  });
  releaseClip(page);

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false });
  const pdfBuffer = Buffer.from(pdfBytes);

  logger.debug('image_to_pdf_render', {
    diagId,
    strategy,
    dpi: effectiveDensity,
    imgFormat: embedFormat,
    imgBytes: embedBuffer.length,
    pdfBytes: pdfBuffer.length,
    convertedFrom,
  });

  return {
    pdfBuffer,
    density: effectiveDensity,
    widthPx: imageWidthPx,
    heightPx: imageHeightPx,
    widthCm: contentWidthCm,
    heightCm: contentHeightCm,
    widthCmPrint: pageWidthCm,
    heightCmPrint: pageHeightCm,
  };
}

export default imageBufferToPdf;
