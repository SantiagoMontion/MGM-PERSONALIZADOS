import sharp from "sharp";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  rgb,
} from "pdf-lib";
import logger from "./logger.js";

const CM_PER_INCH = 2.54;
const PDF_MAX_POINTS = 14_400;
const MAX_USER_UNIT = 75;
const DEFAULT_DPI = 300;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const MIN_EMBED_RATIO = 0.8;

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


function shouldAttemptFallback(err) {
  if (!err) return false;
  if (err.code === "unsupported_image_format") return true;
  if (err.code === "image_metadata_failed") return true;
  if (err.code === "pdf_embed_mismatch") return true;
  const message = typeof err.message === "string" ? err.message.toLowerCase() : "";
  if (!message) return false;
  if (message.includes("unsupported image format")) return true;
  if (message.includes("unsupported image type")) return true;
  if (message.includes("unsupported color")) return true;
  if (message.includes("unsupported png")) return true;
  if (message.includes("failed to parse image")) return true;
  if (message.includes("input buffer contains unsupported")) return true;
  return false;
}

async function convertBufferToPng(buffer) {
  try {
    const converted = await sharp(buffer, { failOnError: false })
      .png({ force: true })
      .toBuffer();
    return { buffer: converted, mime: "image/png" };
  } catch (err) {
    const error = new Error("image_conversion_failed");
    error.code = "image_conversion_failed";
    error.cause = err;
    throw error;
  }
}

async function createPdfFromBuffer({
  imageBuffer,
  widthCm,
  heightCm,
  backgroundColor,
  diagId,
  imageMime,
  source,
}) {
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
  const { embeddedImageStreamLength } = await verifyEmbeddedImage({
    pdfBuffer,
    imageBuffer,
    diagId,
    source,
    mime: imageKind.mime,
    scope: "generatePrintPdf",
    pdfBytes: pdfBuffer.length,
  });

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
    embeddedImageStreamLength,
    pixelWxH: { width: pixelWidth, height: pixelHeight },
    dpi: { x: dpiInfo.x, y: dpiInfo.y, inferred: dpiInfo.inferred },
    pageWxHpt: { width: widthPoints, height: heightPoints },
    pageWxHptUserUnit: { width: pageWidthPt, height: pageHeightPt },
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
      embeddedImageStreamLength,
    },
  };
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

function findFirstImageRawStream(doc) {
  if (!doc?.context?.enumerateIndirectObjects) return null;
  const imageName = PDFName.of("Image");
  const indirectObjects = doc.context.enumerateIndirectObjects();
  for (const [, object] of indirectObjects) {
    if (object instanceof PDFRawStream) {
      const subtype = object.dict?.lookupMaybe?.(PDFName.of("Subtype"), PDFName);
      if (subtype === imageName) {
        return object;
      }
    }
  }
  return null;
}

async function verifyEmbeddedImage({
  pdfBuffer,
  imageBuffer,
  diagId,
  source,
  mime,
  scope = "generatePrintPdf",
  pdfBytes,
}) {
  let loaded;
  try {
    loaded = await PDFDocument.load(pdfBuffer);
  } catch (err) {
    logger.error("pdf_embed_mismatch", {
      diagId,
      source,
      mime: mime || null,
      scope,
      pdfBytes: pdfBytes ?? pdfBuffer.length,
      reason: "pdf_parse_failed",
      message: err?.message || err,
    });
    const error = new Error("pdf_embed_mismatch");
    error.code = "pdf_embed_mismatch";
    error.cause = err;
    throw error;
  }

  const imageStream = findFirstImageRawStream(loaded);
  if (!imageStream) {
    logger.error("pdf_embed_mismatch", {
      diagId,
      source,
      mime: mime || null,
      scope,
      pdfBytes: pdfBytes ?? pdfBuffer.length,
      reason: "image_stream_missing",
    });
    const error = new Error("pdf_embed_mismatch");
    error.code = "pdf_embed_mismatch";
    error.reason = "image_stream_missing";
    throw error;
  }

  let contents;
  if (typeof imageStream.getContents === "function") {
    contents = imageStream.getContents();
  } else if (imageStream.contents) {
    contents = imageStream.contents;
  } else {
    contents = [];
  }
  const streamBytes = Buffer.from(contents || []);
  const embeddedLength = streamBytes.length;
  const context = {
    diagId,
    source,
    mime: mime || null,
    origBytes: imageBuffer.length,
    embeddedImageStreamLength: embeddedLength,
    scope,
    pdfBytes: pdfBytes ?? pdfBuffer.length,
  };

  if (embeddedLength < imageBuffer.length * MIN_EMBED_RATIO) {
    logger.error("pdf_embed_mismatch", {
      ...context,
      reason: "stream_too_small",
    });
    const error = new Error("pdf_embed_mismatch");
    error.code = "pdf_embed_mismatch";
    error.reason = "stream_too_small";
    throw error;
  }

  if (mime === "image/jpeg" || (imageBuffer.length >= 2 && imageBuffer.subarray(0, 2).equals(JPEG_SIGNATURE))) {
    const startsWithSoi = streamBytes.length >= 2 && streamBytes[0] === JPEG_SIGNATURE[0] && streamBytes[1] === JPEG_SIGNATURE[1];
    const endsWithEoi = streamBytes.length >= 2 && streamBytes[streamBytes.length - 2] === JPEG_EOI[0] && streamBytes[streamBytes.length - 1] === JPEG_EOI[1];
    if (!startsWithSoi || !endsWithEoi) {
      logger.error("pdf_embed_mismatch", {
        ...context,
        reason: "jpeg_markers_missing",
        startsWithSoi,
        endsWithEoi,
      });
      const error = new Error("pdf_embed_mismatch");
      error.code = "pdf_embed_mismatch";
      error.reason = "jpeg_markers_missing";
      throw error;
    }
  } else if (mime === "image/png" || (imageBuffer.length >= 8 && imageBuffer.subarray(0, 4).equals(PNG_SIGNATURE))) {
    const startsWithPng = streamBytes.length >= PNG_SIGNATURE.length && streamBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
    const endsWithIend =
      streamBytes.length >= PNG_IEND.length &&
      streamBytes.subarray(streamBytes.length - PNG_IEND.length).equals(PNG_IEND);
    if (!startsWithPng || !endsWithIend) {
      logger.error("pdf_embed_mismatch", {
        ...context,
        reason: "png_signature_mismatch",
        startsWithPng,
        endsWithIend,
      });
      const error = new Error("pdf_embed_mismatch");
      error.code = "pdf_embed_mismatch";
      error.reason = "png_signature_mismatch";
      throw error;
    }
  }

  return { embeddedImageStreamLength: embeddedLength };
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

  let attempt = 0;
  let currentBuffer = imageBuffer;
  let currentMime = imageMime;
  let lastError = null;

  while (attempt < 2) {
    try {
      return await createPdfFromBuffer({
        imageBuffer: currentBuffer,
        widthCm,
        heightCm,
        backgroundColor,
        diagId,
        imageMime: currentMime,
        source,
      });
    } catch (err) {
      lastError = err;
      if (attempt === 0 && shouldAttemptFallback(err)) {
        try {
          logger.warn("pdf_generate_fallback_conversion", {
            diagId,
            source,
            reason: err?.code || err?.message || "unknown",
          });
        } catch {}
        let converted;
        try {
          converted = await convertBufferToPng(imageBuffer);
        } catch (conversionErr) {
          if (conversionErr?.code === "image_conversion_failed") {
            try {
              logger.error("pdf_generate_fallback_failed", {
                diagId,
                source,
                reason: conversionErr?.cause?.message || conversionErr?.message || conversionErr,
              });
            } catch {}
          }
          throw err;
        }
        currentBuffer = converted.buffer;
        currentMime = converted.mime;
        attempt += 1;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("pdf_generate_failed");
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
