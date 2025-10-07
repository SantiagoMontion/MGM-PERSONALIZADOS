import sharp from "sharp";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  rgb,
} from "pdf-lib";
import logger from "./logger.js";

const CM_PER_INCH = 2.54;
const PDF_MAX_POINTS = 14_400;
const MAX_USER_UNIT = 75;
const DEFAULT_BACKGROUND = "#ffffff";
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
    return `#${value.split("").map((ch) => ch + ch).join("")}`;
  }
  return `#${value}`;
}

function hexToRgb(hexColor) {
  const normalized = normalizeBackground(hexColor);
  const value = normalized.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

function selectEmbedKind(format) {
  if (!format) return "jpeg";
  const normalized = String(format).trim().toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") return "jpeg";
  if (normalized === "png") return "png";
  return null;
}

function resolveUserUnit(widthPt, heightPt) {
  const maxDimension = Math.max(widthPt, heightPt);
  if (maxDimension <= PDF_MAX_POINTS) return 1;
  const computed = Math.ceil(maxDimension / PDF_MAX_POINTS);
  return Math.min(MAX_USER_UNIT, Math.max(1, computed));
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
  ]
    .map((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    })
    .filter((value) => value != null);
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

function resolveStrategy() {
  return STRATEGY;
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

function pointsToCentimeters(points) {
  return (points / 72) * CM_PER_INCH;
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

  const metadata = await readMetadata(buffer);
  const effectiveDensity = resolveDensity({ density, widthCm, heightCm, bleedCm }, metadata);
  const embedKind = selectEmbedKind(metadata?.format) || 'jpeg';
  let embedBuffer = buffer;
  let embedFormat = embedKind;
  let convertedFrom = null;

  if (embedKind !== 'jpeg' && embedKind !== 'png') {
    convertedFrom = metadata?.format || 'unknown';
    embedFormat = 'png';
    embedBuffer = await sharp(buffer, { failOnError: false })
      .png({ compressionLevel: 0, progressive: false, adaptiveFiltering: false })
      .toBuffer();
  }

  const pdfDoc = await PDFDocument.create();
  const embedded = embedFormat === 'png'
    ? await pdfDoc.embedPng(embedBuffer)
    : await pdfDoc.embedJpg(embedBuffer);

  const intrinsicWidthPt = embedded.width;
  const intrinsicHeightPt = embedded.height;
  if (!intrinsicWidthPt || !intrinsicHeightPt) {
    const error = new Error('image_dimensions_invalid');
    error.code = 'image_dimensions_invalid';
    throw error;
  }

  const userUnit = resolveUserUnit(intrinsicWidthPt, intrinsicHeightPt);
  const pageWidthPt = intrinsicWidthPt / userUnit;
  const pageHeightPt = intrinsicHeightPt / userUnit;
  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  if (userUnit !== 1) {
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
  }

  const normalizedBackground = normalizeBackground(background);
  const { r, g, b } = hexToRgb(normalizedBackground);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidthPt,
    height: pageHeightPt,
    color: rgb(r / 255, g / 255, b / 255),
  });

  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: pageWidthPt,
    height: pageHeightPt,
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
  const pdfBuffer = Buffer.from(pdfBytes);

  logger.debug('image_to_pdf_render', {
    diagId,
    strategy: resolveStrategy(),
    userUnit,
    dpi: effectiveDensity,
    imgFormat: embedFormat,
    imgBytes: embedBuffer.length,
    pdfBytes: pdfBuffer.length,
    convertedFrom,
  });

  const widthPx = intrinsicWidthPt;
  const heightPx = intrinsicHeightPt;
  const contentWidthCm = toNumber(widthCm) ?? pointsToCentimeters(intrinsicWidthPt);
  const contentHeightCm = toNumber(heightCm) ?? pointsToCentimeters(intrinsicHeightPt);
  const bleedValueCm = Math.max(0, toNumber(bleedCm, 0));

  return {
    pdfBuffer,
    density: effectiveDensity,
    widthPx,
    heightPx,
    widthCm: contentWidthCm,
    heightCm: contentHeightCm,
    widthCmPrint: contentWidthCm + bleedValueCm * 2,
    heightCmPrint: contentHeightCm + bleedValueCm * 2,
    userUnit,
  };
}

export default imageBufferToPdf;

