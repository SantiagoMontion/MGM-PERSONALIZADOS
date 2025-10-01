import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

const DEFAULT_DENSITY = 300;
const DEFAULT_BACKGROUND = "#ffffff";
const CM_PER_INCH = 2.54;

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
