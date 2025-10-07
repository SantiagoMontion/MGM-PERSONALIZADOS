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

export async function generatePrintPdf({
  widthCm,
  heightCm,
  backgroundColor,
  imageBuffer,
  diagId,
}) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    const error = new Error("invalid_image_buffer");
    error.code = "invalid_image_buffer";
    throw error;
  }

  const metadata = await readMetadata(imageBuffer);
  const embedKind = selectEmbedKind(metadata?.format) || "jpeg";
  let embedBuffer = imageBuffer;
  let embedFormat = embedKind;
  let convertedFrom = null;

  if (embedKind !== "jpeg" && embedKind !== "png") {
    convertedFrom = metadata?.format || "unknown";
    embedFormat = "png";
    embedBuffer = await sharp(imageBuffer, { failOnError: false })
      .png({ compressionLevel: 0, progressive: false, adaptiveFiltering: false })
      .toBuffer();
  }

  const pdfDoc = await PDFDocument.create();
  const embedImage = embedFormat === "png"
    ? await pdfDoc.embedPng(embedBuffer)
    : await pdfDoc.embedJpg(embedBuffer);

  const intrinsicWidthPt = embedImage.width;
  const intrinsicHeightPt = embedImage.height;
  if (!intrinsicWidthPt || !intrinsicHeightPt) {
    const error = new Error("image_dimensions_invalid");
    error.code = "image_dimensions_invalid";
    throw error;
  }

  const userUnit = resolveUserUnit(intrinsicWidthPt, intrinsicHeightPt);
  const pageWidthPt = intrinsicWidthPt / userUnit;
  const pageHeightPt = intrinsicHeightPt / userUnit;
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

  logger.debug("pdf_generate_render", {
    diagId,
    strategy: "original_1to1",
    userUnit,
    imgFormat: embedFormat,
    imgBytes: embedBuffer.length,
    pdfBytes: pdfBuffer.length,
    convertedFrom,
  });

  const artworkWidthPx = intrinsicWidthPt;
  const artworkHeightPx = intrinsicHeightPt;
  const pageWidthCm = pointsToCentimeters(intrinsicWidthPt);
  const pageHeightCm = pointsToCentimeters(intrinsicHeightPt);

  return {
    buffer: pdfBuffer,
    info: {
      pageWidthCm,
      pageHeightCm,
      marginCm: 0,
      dpi: null,
      strategy: "original_1to1",
      area: {
        widthCm: widthCm ? Number(widthCm) : pageWidthCm,
        heightCm: heightCm ? Number(heightCm) : pageHeightCm,
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
      imageFormat: embedFormat,
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

