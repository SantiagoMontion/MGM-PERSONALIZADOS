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
const DEFAULT_DPI = 300;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);

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

function resolveUserUnit(widthPt, heightPt) {
  const maxDimension = Math.max(widthPt, heightPt);
  if (maxDimension <= PDF_MAX_POINTS) return 1;
  const computed = Math.ceil(maxDimension / PDF_MAX_POINTS);
  return Math.min(MAX_USER_UNIT, Math.max(1, computed));
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

function normalizeImageMime(input) {
  if (!input) return null;
  const raw = String(input).toLowerCase();
  if (raw.includes("png")) return "image/png";
  if (raw.includes("jpeg") || raw.includes("jpg")) return "image/jpeg";
  return null;
}

function detectImageKind(buffer, declaredMime, metadataFormat) {
  const normalizedDeclared = normalizeImageMime(declaredMime);
  if (normalizedDeclared === "image/png") {
    return { kind: "png", mime: "image/png" };
  }
  if (normalizedDeclared === "image/jpeg") {
    return { kind: "jpeg", mime: "image/jpeg" };
  }

  if (buffer?.length >= 4 && buffer.subarray(0, 4).equals(PNG_SIGNATURE)) {
    return { kind: "png", mime: "image/png" };
  }
  if (buffer?.length >= 2 && buffer.subarray(0, 2).equals(JPEG_SIGNATURE)) {
    return { kind: "jpeg", mime: "image/jpeg" };
  }

  if (metadataFormat) {
    const normalizedFormat = String(metadataFormat).trim().toLowerCase();
    if (normalizedFormat === "png") {
      return { kind: "png", mime: "image/png" };
    }
    if (normalizedFormat === "jpeg" || normalizedFormat === "jpg") {
      return { kind: "jpeg", mime: "image/jpeg" };
    }
  }

  return { kind: null, mime: normalizedDeclared || null };
}

function toDpi(value, unit) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (!unit) return num;
  const normalized = String(unit).toLowerCase();
  if (normalized.includes("metre")) {
    return num / 39.3700787;
  }
  if (normalized.includes("centimet")) {
    return num * CM_PER_INCH;
  }
  return num;
}

function computeDpiFromDimension(pixels, cm) {
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  if (!Number.isFinite(cm) || cm <= 0) return null;
  const inches = cm / CM_PER_INCH;
  if (!Number.isFinite(inches) || inches <= 0) return null;
  return pixels / inches;
}

function extractEffectiveDpi({ metadata, options = {} }) {
  const densityUnit = metadata?.densityUnits || metadata?.resolutionUnit || null;
  const metadataDpiX = [
    toDpi(metadata?.density, densityUnit),
    toDpi(metadata?.xDensity, densityUnit),
    toDpi(metadata?.xResolution, densityUnit),
    toDpi(metadata?.resolution, densityUnit),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const metadataDpiY = [
    toDpi(metadata?.density, densityUnit),
    toDpi(metadata?.yDensity, densityUnit),
    toDpi(metadata?.yResolution, densityUnit),
    toDpi(metadata?.resolution, densityUnit),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const pixelWidth = Number(metadata?.width);
  const pixelHeight = Number(metadata?.height);
  const widthCm = toNumber(options?.widthCm);
  const heightCm = toNumber(options?.heightCm);
  const bleedCm = Math.max(0, toNumber(options?.bleedCm, 0));
  const densityOverride = Number.isFinite(options?.density) ? Number(options.density) : null;

  const dimensionDpiX = [
    computeDpiFromDimension(pixelWidth, widthCm),
    computeDpiFromDimension(pixelWidth, widthCm != null ? widthCm + bleedCm * 2 : null),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const dimensionDpiY = [
    computeDpiFromDimension(pixelHeight, heightCm),
    computeDpiFromDimension(pixelHeight, heightCm != null ? heightCm + bleedCm * 2 : null),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const candidatesX = [
    ...metadataDpiX,
    ...dimensionDpiX,
  ];
  const candidatesY = [
    ...metadataDpiY,
    ...dimensionDpiY,
  ];

  if (Number.isFinite(densityOverride) && densityOverride >= 72) {
    candidatesX.push(densityOverride);
    candidatesY.push(densityOverride);
  }
  if (ENV_DPI_VALID) {
    candidatesX.push(ENV_DPI_VALID);
    candidatesY.push(ENV_DPI_VALID);
  }

  const dpiX = candidatesX.length ? Math.max(...candidatesX) : DEFAULT_DPI;
  const dpiY = candidatesY.length ? Math.max(...candidatesY) : DEFAULT_DPI;
  const inferred = candidatesX.length === 0 && candidatesY.length === 0;

  return { x: dpiX, y: dpiY, inferred };
}

function computeDimensionPoints(pixels, dpi) {
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  if (!Number.isFinite(dpi) || dpi <= 0) return null;
  return (pixels / dpi) * 72;
}

export async function imageBufferToPdf({
  buffer,
  density,
  background,
  bleedCm = 0,
  widthCm,
  heightCm,
  diagId,
  imageMime,
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('invalid_image_buffer');
    error.code = 'invalid_image_buffer';
    throw error;
  }

  const metadata = await readMetadata(buffer);
  const pixelWidth = Number(metadata?.width);
  const pixelHeight = Number(metadata?.height);
  if (!Number.isFinite(pixelWidth) || pixelWidth <= 0 || !Number.isFinite(pixelHeight) || pixelHeight <= 0) {
    const error = new Error('image_dimensions_invalid');
    error.code = 'image_dimensions_invalid';
    throw error;
  }

  const dpiInfo = extractEffectiveDpi({ metadata, options: { density, widthCm, heightCm, bleedCm } });
  const widthPoints = computeDimensionPoints(pixelWidth, dpiInfo.x);
  const heightPoints = computeDimensionPoints(pixelHeight, dpiInfo.y);
  if (!Number.isFinite(widthPoints) || widthPoints <= 0 || !Number.isFinite(heightPoints) || heightPoints <= 0) {
    const error = new Error('image_points_invalid');
    error.code = 'image_points_invalid';
    throw error;
  }

  const imageKind = detectImageKind(buffer, imageMime, metadata?.format);
  if (imageKind.kind !== 'jpeg' && imageKind.kind !== 'png') {
    logger.error('image_to_pdf_unsupported_format', {
      diagId,
      mime: imageKind.mime || imageMime || null,
      metadataFormat: metadata?.format || null,
    });
    const error = new Error('unsupported_image_format');
    error.code = 'unsupported_image_format';
    throw error;
  }

  const pdfDoc = await PDFDocument.create();
  const embedded = imageKind.kind === 'png'
    ? await pdfDoc.embedPng(buffer)
    : await pdfDoc.embedJpg(buffer);

  const userUnit = resolveUserUnit(widthPoints, heightPoints);
  const pageWidthPt = widthPoints / userUnit;
  const pageHeightPt = heightPoints / userUnit;
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

  const actualWidthCm = pointsToCentimeters(widthPoints);
  const actualHeightCm = pointsToCentimeters(heightPoints);
  const widthResultCm = toNumber(widthCm) ?? actualWidthCm;
  const heightResultCm = toNumber(heightCm) ?? actualHeightCm;
  const bleedValueCm = Math.max(0, toNumber(bleedCm, 0));
  const dominantDpi = Math.max(dpiInfo.x, dpiInfo.y);

  logger.debug('image_to_pdf_render', {
    diagId,
    strategy: resolveStrategy(),
    userUnit,
    dpi: { x: dpiInfo.x, y: dpiInfo.y, inferred: dpiInfo.inferred },
    mime: imageKind.mime,
    imgBytes: buffer.length,
    pdfBytes: pdfBuffer.length,
    pixelWxH: { width: pixelWidth, height: pixelHeight },
    drawWxHpts: { width: widthPoints, height: heightPoints },
  });

  if (pdfBuffer.length < buffer.length * 0.5) {
    logger.warn('image_to_pdf_size_warning', {
      diagId,
      mime: imageKind.mime,
      imgBytes: buffer.length,
      pdfBytes: pdfBuffer.length,
    });
  }

  return {
    pdfBuffer,
    density: dominantDpi,
    dpi: { x: dpiInfo.x, y: dpiInfo.y, inferred: dpiInfo.inferred },
    widthPx: pixelWidth,
    heightPx: pixelHeight,
    widthCm: widthResultCm,
    heightCm: heightResultCm,
    widthCmPrint: widthResultCm + bleedValueCm * 2,
    heightCmPrint: heightResultCm + bleedValueCm * 2,
    userUnit,
  };
}

export default imageBufferToPdf;
