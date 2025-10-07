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
const DEFAULT_DPI = 300;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);

function normalizeColor(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "#ffffff";
  const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!hexMatch) return "#ffffff";
  const [, value] = hexMatch;
  if (value.length === 3) {
    return `#${value.split("").map((ch) => ch + ch).join("")}`;
  }
  return `#${value}`;
}

function hexToRgb(hexColor) {
  const normalized = normalizeColor(hexColor);
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

async function readMetadata(buffer) {
  try {
    return await sharp(buffer, { failOnError: false }).metadata();
  } catch (err) {
    const error = new Error("image_metadata_failed");
    error.code = "image_metadata_failed";
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

function extractDpi(metadata) {
  const densityUnit = metadata?.densityUnits || metadata?.resolutionUnit || null;
  const dpiCandidatesX = [
    toDpi(metadata?.density, densityUnit),
    toDpi(metadata?.xDensity, densityUnit),
    toDpi(metadata?.xResolution, densityUnit),
    toDpi(metadata?.resolution, densityUnit),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const dpiCandidatesY = [
    toDpi(metadata?.density, densityUnit),
    toDpi(metadata?.yDensity, densityUnit),
    toDpi(metadata?.yResolution, densityUnit),
    toDpi(metadata?.resolution, densityUnit),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const dpiX = dpiCandidatesX.length ? Math.max(...dpiCandidatesX) : DEFAULT_DPI;
  const dpiY = dpiCandidatesY.length ? Math.max(...dpiCandidatesY) : DEFAULT_DPI;

  return {
    x: dpiX,
    y: dpiY,
    inferred: dpiCandidatesX.length === 0 && dpiCandidatesY.length === 0,
  };
}

function computeDimensionPoints(pixels, dpi) {
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  if (!Number.isFinite(dpi) || dpi <= 0) return null;
  return (pixels / dpi) * 72;
}

export async function generatePrintPdf({
  widthCm,
  heightCm,
  backgroundColor,
  imageBuffer,
  diagId,
  imageMime,
  source = "unknown",
}) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    const error = new Error("invalid_image_buffer");
    error.code = "invalid_image_buffer";
    throw error;
  }

  const metadata = await readMetadata(imageBuffer);
  const pixelWidth = Number(metadata?.width);
  const pixelHeight = Number(metadata?.height);
  if (!Number.isFinite(pixelWidth) || pixelWidth <= 0 || !Number.isFinite(pixelHeight) || pixelHeight <= 0) {
    const error = new Error("image_dimensions_invalid");
    error.code = "image_dimensions_invalid";
    throw error;
  }

  const dpiInfo = extractDpi(metadata);
  const widthPoints = computeDimensionPoints(pixelWidth, dpiInfo.x);
  const heightPoints = computeDimensionPoints(pixelHeight, dpiInfo.y);
  if (!Number.isFinite(widthPoints) || widthPoints <= 0 || !Number.isFinite(heightPoints) || heightPoints <= 0) {
    const error = new Error("image_points_invalid");
    error.code = "image_points_invalid";
    throw error;
  }

  const imageKind = detectImageKind(imageBuffer, imageMime, metadata?.format);
  if (imageKind.kind !== "jpeg" && imageKind.kind !== "png") {
    logger.error("pdf_generate_unsupported_format", {
      diagId,
      source,
      mime: imageKind.mime || imageMime || null,
      metadataFormat: metadata?.format || null,
    });
    const error = new Error("unsupported_image_format");
    error.code = "unsupported_image_format";
    throw error;
  }

  const pdfDoc = await PDFDocument.create();
  const embedImage = imageKind.kind === "png"
    ? await pdfDoc.embedPng(imageBuffer)
    : await pdfDoc.embedJpg(imageBuffer);

  const userUnit = resolveUserUnit(widthPoints, heightPoints);
  const pageWidthPt = widthPoints / userUnit;
  const pageHeightPt = heightPoints / userUnit;
  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  if (userUnit !== 1) {
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(userUnit));
  }

  const normalizedColor = normalizeColor(backgroundColor);
  const { r, g, b } = hexToRgb(normalizedColor);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidthPt,
    height: pageHeightPt,
    color: rgb(r / 255, g / 255, b / 255),
  });

  page.drawImage(embedImage, {
    x: 0,
    y: 0,
    width: pageWidthPt,
    height: pageHeightPt,
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
  const pdfBuffer = Buffer.from(pdfBytes);

  const pageWidthCm = pointsToCentimeters(widthPoints);
  const pageHeightCm = pointsToCentimeters(heightPoints);
  const areaWidthCm = widthCm ? Number(widthCm) : pageWidthCm;
  const areaHeightCm = heightCm ? Number(heightCm) : pageHeightCm;

  logger.debug("pdf_generate_render", {
    diagId,
    strategy: "original_bytes_embed",
    source,
    userUnit,
    mime: imageKind.mime,
    origBytes: imageBuffer.length,
    pdfBytes: pdfBuffer.length,
    pixelWxH: { width: pixelWidth, height: pixelHeight },
    dpi: { x: dpiInfo.x, y: dpiInfo.y, inferred: dpiInfo.inferred },
    drawWxHpts: { width: widthPoints, height: heightPoints },
  });

  if (pdfBuffer.length < imageBuffer.length * 0.5) {
    logger.warn("pdf_generate_size_warning", {
      diagId,
      source,
      mime: imageKind.mime,
      origBytes: imageBuffer.length,
      pdfBytes: pdfBuffer.length,
    });
  }

  const artworkWidthPx = pixelWidth;
  const artworkHeightPx = pixelHeight;

  return {
    buffer: pdfBuffer,
    info: {
      pageWidthCm,
      pageHeightCm,
      marginCm: 0,
      dpi: { x: dpiInfo.x, y: dpiInfo.y, inferred: dpiInfo.inferred },
      strategy: "original_bytes_embed",
      area: {
        widthCm: areaWidthCm,
        heightCm: areaHeightCm,
        widthPx: artworkWidthPx,
        heightPx: artworkHeightPx,
      },
      artwork: {
        widthPx: artworkWidthPx,
        heightPx: artworkHeightPx,
        offsetLeftPx: 0,
        offsetTopPx: 0,
        scale: 1,
      },
      backgroundColor: normalizedColor,
      imageFormat: imageKind.kind,
      userUnit,
    },
  };
}

export async function validatePrintPdf({
  buffer,
  expectedPageWidthCm,
  expectedPageHeightCm,
  expectedAreaWidthCm,
  expectedAreaHeightCm,
  marginCm = 0,
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

  const userUnitValue = page.node.get(PDFName.of('UserUnit'));
  const userUnit = userUnitValue ? (userUnitValue.asNumber?.() ?? Number(userUnitValue)) : 1;
  const { width: pageWidthPt, height: pageHeightPt } = page.getSize();
  const effectiveWidthPt = pageWidthPt * userUnit;
  const effectiveHeightPt = pageHeightPt * userUnit;

  const measuredPageWidthCm = pointsToCentimeters(effectiveWidthPt);
  const measuredPageHeightCm = pointsToCentimeters(effectiveHeightPt);
  const measuredAreaWidthCm = measuredPageWidthCm - marginCm * 2;
  const measuredAreaHeightCm = measuredPageHeightCm - marginCm * 2;

  let expectedPageWidth = Number(expectedPageWidthCm);
  let expectedPageHeight = Number(expectedPageHeightCm);
  let expectedAreaWidth = Number(expectedAreaWidthCm);
  let expectedAreaHeight = Number(expectedAreaHeightCm);

  const needsAdjustment = (measured, expected) => {
    if (!Number.isFinite(expected) || expected <= 0) return false;
    const differenceMm = Math.abs(measured - expected) * 10;
    return differenceMm > toleranceMm + 1e-6;
  };

  if (needsAdjustment(measuredPageWidthCm, expectedPageWidth)) {
    expectedPageWidth = measuredPageWidthCm;
    expectedAreaWidth = measuredAreaWidthCm;
  }
  if (needsAdjustment(measuredPageHeightCm, expectedPageHeight)) {
    expectedPageHeight = measuredPageHeightCm;
    expectedAreaHeight = measuredAreaHeightCm;
  }

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
    userUnit,
  };
}

export default generatePrintPdf;
