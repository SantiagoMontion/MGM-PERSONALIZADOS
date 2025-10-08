import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import logger from "./logger.js";
import { makeErr } from "./errors.js";

const DEFAULT_DENSITY = 300;
const DEFAULT_BACKGROUND = "#ffffff";
const CM_PER_INCH = 2.54;
const MM_PER_INCH = 25.4;

function isBuffer(value) {
  return Buffer.isBuffer(value);
}

function resolveDensity(options, metadata) {
  if (options?.density && Number.isFinite(options.density)) {
    return Math.max(72, Number(options.density));
  }
  if (metadata?.density && Number.isFinite(metadata.density)) {
    return Number(metadata.density);
  }
  return DEFAULT_DENSITY;
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

function normalizeMillimeters(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function mmToPoints(value) {
  const numeric = normalizeMillimeters(value);
  if (numeric === null) return null;
  return (numeric * 72) / MM_PER_INCH;
}

function detectImageMime(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", type: "jpg" };
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: "image/png", type: "png" };
  }
  return null;
}

function computeLosslessLayout({ widthPx, heightPx, targetWidthMm, targetHeightMm }) {
  const width = Math.max(1, Number(widthPx) || 1);
  const height = Math.max(1, Number(heightPx) || 1);
  const normalizedWidthMm = normalizeMillimeters(targetWidthMm);
  const normalizedHeightMm = normalizeMillimeters(targetHeightMm);

  if (normalizedWidthMm && normalizedHeightMm) {
    const pageWidthPt = mmToPoints(normalizedWidthMm);
    const pageHeightPt = mmToPoints(normalizedHeightMm);
    const scale = Math.min(pageWidthPt / width, pageHeightPt / height);
    const drawWidthPt = width * scale;
    const drawHeightPt = height * scale;
    const offsetX = (pageWidthPt - drawWidthPt) / 2;
    const offsetY = (pageHeightPt - drawHeightPt) / 2;
    return {
      pageWidthPt,
      pageHeightPt,
      drawWidthPt,
      drawHeightPt,
      offsetX,
      offsetY,
      targetWidthMm: normalizedWidthMm,
      targetHeightMm: normalizedHeightMm,
    };
  }

  if (normalizedWidthMm) {
    const pageWidthPt = mmToPoints(normalizedWidthMm);
    const scale = pageWidthPt / width;
    const drawWidthPt = pageWidthPt;
    const drawHeightPt = height * scale;
    return {
      pageWidthPt,
      pageHeightPt: drawHeightPt,
      drawWidthPt,
      drawHeightPt,
      offsetX: 0,
      offsetY: 0,
      targetWidthMm: normalizedWidthMm,
      targetHeightMm: normalizedWidthMm * (height / width),
    };
  }

  if (normalizedHeightMm) {
    const pageHeightPt = mmToPoints(normalizedHeightMm);
    const scale = pageHeightPt / height;
    const drawHeightPt = pageHeightPt;
    const drawWidthPt = width * scale;
    return {
      pageWidthPt: drawWidthPt,
      pageHeightPt,
      drawWidthPt,
      drawHeightPt,
      offsetX: 0,
      offsetY: 0,
      targetWidthMm: normalizedHeightMm * (width / height),
      targetHeightMm: normalizedHeightMm,
    };
  }

  return {
    pageWidthPt: width,
    pageHeightPt: height,
    drawWidthPt: width,
    drawHeightPt: height,
    offsetX: 0,
    offsetY: 0,
    targetWidthMm: null,
    targetHeightMm: null,
  };
}

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export async function imageBufferToPdf({
  buffer,
  density,
  background,
  bleedCm = 0,
  widthCm,
  heightCm,
} = {}) {
  if (!isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('invalid_image_buffer');
    error.code = 'invalid_image_buffer';
    throw error;
  }

  const baseImage = sharp(buffer);
  const metadata = await baseImage.metadata();
  const effectiveBackground = normalizeBackground(background);
  let effectiveDensity = resolveDensity({ density }, metadata);

  const baseWidthCm = toNumber(widthCm);
  const baseHeightCm = toNumber(heightCm);
  let targetWidthCm = baseWidthCm;
  let targetHeightCm = baseHeightCm;
  const bleedValueCm = Math.max(0, toNumber(bleedCm, 0));
  if (targetWidthCm && targetHeightCm && bleedValueCm > 0) {
    targetWidthCm += bleedValueCm * 2;
    targetHeightCm += bleedValueCm * 2;
  }

  const computeDensityCandidate = (pixels, cm) => {
    if (!pixels || !cm || cm <= 0) return 0;
    const inches = cm / CM_PER_INCH;
    if (inches <= 0) return 0;
    return pixels / inches;
  };
  const metaWidthPx = metadata?.width || 0;
  const metaHeightPx = metadata?.height || 0;
  const densityCandidates = [];
  if (metaWidthPx) {
    if (baseWidthCm) densityCandidates.push(computeDensityCandidate(metaWidthPx, baseWidthCm));
    if (targetWidthCm) densityCandidates.push(computeDensityCandidate(metaWidthPx, targetWidthCm));
  }
  if (metaHeightPx) {
    if (baseHeightCm) densityCandidates.push(computeDensityCandidate(metaHeightPx, baseHeightCm));
    if (targetHeightCm) densityCandidates.push(computeDensityCandidate(metaHeightPx, targetHeightCm));
  }
  const validCandidates = densityCandidates.filter((value) => Number.isFinite(value) && value > 0);
  if (validCandidates.length) {
    const maxCandidate = Math.max(...validCandidates);
    if (maxCandidate > effectiveDensity) {
      effectiveDensity = maxCandidate;
    }
  }

  let preparedBuffer = buffer;
  let preparedMetadata = metadata;
  if (metadata?.format !== 'png' || metadata?.hasAlpha) {
    preparedBuffer = await baseImage
      .flatten({ background: effectiveBackground })
      .withMetadata({ density: effectiveDensity })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    preparedMetadata = await sharp(preparedBuffer).metadata();
  } else if (metadata?.density !== effectiveDensity) {
    preparedBuffer = await baseImage
      .withMetadata({ density: effectiveDensity })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    preparedMetadata = await sharp(preparedBuffer).metadata();
  }

  const pngImage = await sharp(preparedBuffer).png().toBuffer();
  const pngMeta = preparedMetadata || (await sharp(pngImage).metadata());
  const originalWidthPx = pngMeta?.width || metadata?.width || 1000;
  const originalHeightPx = pngMeta?.height || metadata?.height || 1000;

  const cmToPoints = (cm) => (cm / CM_PER_INCH) * 72;
  const cmToPixels = (cm) => (cm / CM_PER_INCH) * effectiveDensity;
  const computedPageWidthPt = targetWidthCm ? cmToPoints(targetWidthCm) : null;
  const computedPageHeightPt = targetHeightCm ? cmToPoints(targetHeightCm) : null;
  const computedPageWidthPx = targetWidthCm ? Math.round(cmToPixels(targetWidthCm)) : null;
  const computedPageHeightPx = targetHeightCm ? Math.round(cmToPixels(targetHeightCm)) : null;

  let scaledBuffer = pngImage;
  let widthPx = originalWidthPx;
  let heightPx = originalHeightPx;
  let pageWidth = computedPageWidthPt || (originalWidthPx * (72 / effectiveDensity));
  let pageHeight = computedPageHeightPt || (originalHeightPx * (72 / effectiveDensity));

  const shouldResize = computedPageWidthPx && computedPageHeightPx
    ? Math.abs(computedPageWidthPx - originalWidthPx) > 1 || Math.abs(computedPageHeightPx - originalHeightPx) > 1
    : false;
  if (shouldResize && computedPageWidthPx && computedPageHeightPx) {
    scaledBuffer = await sharp(pngImage)
      .resize(computedPageWidthPx, computedPageHeightPx, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .toBuffer();
    widthPx = computedPageWidthPx;
    heightPx = computedPageHeightPx;
    pageWidth = computedPageWidthPt;
    pageHeight = computedPageHeightPt;
  }

  const pdfDoc = await PDFDocument.create();
  const embeddedPng = await pdfDoc.embedPng(scaledBuffer);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawImage(embeddedPng, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  const pdfBytes = await pdfDoc.save();
  return {
    pdfBuffer: Buffer.from(pdfBytes),
    density: effectiveDensity,
    widthPx,
    heightPx,
    widthCm: baseWidthCm ?? null,
    heightCm: baseHeightCm ?? null,
    widthCmPrint: targetWidthCm ?? null,
    heightCmPrint: targetHeightCm ?? null,
  };
}

export default imageBufferToPdf;

export async function imageBufferToPdfLossless({
  buffer,
  targetWidthMm,
  targetHeightMm,
  rid,
  diagId,
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw makeErr("invalid_image_buffer", { code: "invalid_image_buffer" });
  }

  const detected = detectImageMime(buffer);
  if (!detected) {
    throw makeErr("unsupported_image_format", { rid: rid || null, diagId: diagId || null });
  }

  const pdfDoc = await PDFDocument.create();
  let embedded;
  if (detected.type === "jpg") {
    embedded = await pdfDoc.embedJpg(buffer);
  } else {
    embedded = await pdfDoc.embedPng(buffer);
  }

  const { width: widthPx, height: heightPx } = embedded;
  const layout = computeLosslessLayout({
    widthPx,
    heightPx,
    targetWidthMm,
    targetHeightMm,
  });

  logger.info("lossless_pdf_embed", {
    diagId: diagId || null,
    rid: rid || null,
    bytes: buffer.length,
    mime: detected.mime,
    widthPx,
    heightPx,
  });

  const page = pdfDoc.addPage([layout.pageWidthPt, layout.pageHeightPt]);
  page.drawImage(embedded, {
    x: layout.offsetX,
    y: layout.offsetY,
    width: layout.drawWidthPt,
    height: layout.drawHeightPt,
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    pdfBuffer: Buffer.from(pdfBytes),
    info: {
      mime: detected.mime,
      widthPx,
      heightPx,
      pageWidthPt: layout.pageWidthPt,
      pageHeightPt: layout.pageHeightPt,
      drawWidthPt: layout.drawWidthPt,
      drawHeightPt: layout.drawHeightPt,
      targetWidthMm: layout.targetWidthMm,
      targetHeightMm: layout.targetHeightMm,
    },
  };
}
