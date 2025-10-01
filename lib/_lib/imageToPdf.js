import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

const DEFAULT_DENSITY = 300;
const DEFAULT_BACKGROUND = "#ffffff";

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

export async function imageBufferToPdf({
  buffer,
  density,
  background,
} = {}) {
  if (!isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('invalid_image_buffer');
    error.code = 'invalid_image_buffer';
    throw error;
  }

  const baseImage = sharp(buffer);
  const metadata = await baseImage.metadata();
  const effectiveBackground = normalizeBackground(background);
  const effectiveDensity = resolveDensity({ density }, metadata);

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
  const widthPx = pngMeta?.width || metadata?.width || 1000;
  const heightPx = pngMeta?.height || metadata?.height || 1000;

  const pdfDoc = await PDFDocument.create();
  const embeddedPng = await pdfDoc.embedPng(pngImage);
  const scale = 72 / effectiveDensity;
  const pageWidth = embeddedPng.width * scale;
  const pageHeight = embeddedPng.height * scale;
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
  };
}

export default imageBufferToPdf;
