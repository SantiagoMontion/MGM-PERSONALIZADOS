import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  rgb,
  degrees,
} from "pdf-lib";
import { ssim } from "ssim.js";

const CM_PER_INCH = 2.54;
const DEFAULT_BACKGROUND = "#ffffff";
const DEFAULT_TARGET_PPI = 72;
const DEFAULT_BLEED_CM = 2;
const SRGB_PROFILE_PATH = fileURLToPath(new URL("./color-profiles/sRGB.icc", import.meta.url));
const MAX_DEFAULT_PIXELS = 20000 * 20000;
const QA_BASE_DENSITY = 600;
const QA_MIN_DENSITY = 150;
const QA_MAX_PIXELS = 10000 * 10000;
const PDF_SIZE_LIMIT_BYTES = 250 * 1024 * 1024;

let cachedSrgbProfile = null;

function isBuffer(value) {
  return Buffer.isBuffer(value);
}

function toFiniteNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampBleedCm(value) {
  const numeric = toFiniteNumber(value, DEFAULT_BLEED_CM / 2);
  if (numeric == null) return 0;
  return Math.max(0, numeric);
}

function normalizeHexColor(color, fallback = DEFAULT_BACKGROUND) {
  if (!color) return fallback;
  const raw = String(color).trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match) return fallback;
  const value = match[1];
  if (value.length === 3) {
    return `#${value.split('').map((ch) => ch + ch).join('')}`.toLowerCase();
  }
  return `#${value.toLowerCase()}`;
}

function hexToRgb01(hex) {
  const normalized = normalizeHexColor(hex);
  const value = normalized.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return { r, g, b };
}

function cmToPoints(cm) {
  return (cm / CM_PER_INCH) * 72;
}

function computeQaGeometry(pageWidthPt, pageHeightPt) {
  const baseWidthPx = Math.max(1, Math.round((pageWidthPt / 72) * QA_BASE_DENSITY));
  const baseHeightPx = Math.max(1, Math.round((pageHeightPt / 72) * QA_BASE_DENSITY));
  const basePixels = baseWidthPx * baseHeightPx;
  if (basePixels <= QA_MAX_PIXELS) {
    return { density: QA_BASE_DENSITY, pageWidthPx: baseWidthPx, pageHeightPx: baseHeightPx };
  }
  const scale = Math.sqrt(QA_MAX_PIXELS / basePixels);
  const density = Math.max(QA_MIN_DENSITY, Math.round(QA_BASE_DENSITY * scale));
  const widthPx = Math.max(1, Math.round((pageWidthPt / 72) * density));
  const heightPx = Math.max(1, Math.round((pageHeightPt / 72) * density));
  return { density, pageWidthPx: widthPx, pageHeightPx: heightPx };
}

function getOrientationInfo(orientation, widthPx, heightPx) {
  switch (orientation) {
    case 2:
      return { widthPx, heightPx, swap: false, transform: 'mirror-horizontal' };
    case 3:
      return { widthPx, heightPx, swap: false, transform: 'rotate-180' };
    case 4:
      return { widthPx, heightPx, swap: false, transform: 'mirror-vertical' };
    case 5:
      return { widthPx: heightPx, heightPx: widthPx, swap: true, transform: 'transpose' };
    case 6:
      return { widthPx: heightPx, heightPx: widthPx, swap: true, transform: 'rotate-90' };
    case 7:
      return { widthPx: heightPx, heightPx: widthPx, swap: true, transform: 'transverse' };
    case 8:
      return { widthPx: heightPx, heightPx: widthPx, swap: true, transform: 'rotate-270' };
    case 1:
    default:
      return { widthPx, heightPx, swap: false, transform: 'identity' };
  }
}

async function loadSrgbProfile() {
  if (cachedSrgbProfile) return cachedSrgbProfile;
  const buffer = await readFile(SRGB_PROFILE_PATH);
  cachedSrgbProfile = buffer;
  return buffer;
}

function computePsnrAndSsim(reference, candidate) {
  if (!reference || !candidate) return { psnr: null, ssim: null };
  const { data: refData, info: refInfo } = reference;
  const { data: candData, info: candInfo } = candidate;
  if (!refInfo || !candInfo) return { psnr: null, ssim: null };
  if (refInfo.width !== candInfo.width || refInfo.height !== candInfo.height) return { psnr: null, ssim: null };
  const channels = Math.min(refInfo.channels, candInfo.channels);
  const pixels = refInfo.width * refInfo.height * channels;
  let mse = 0;
  for (let i = 0; i < pixels; i += 1) {
    const diff = refData[i] - candData[i];
    mse += diff * diff;
  }
  mse /= pixels;
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
  const ssimValue = ssim(
    { data: refData, width: refInfo.width, height: refInfo.height },
    { data: candData, width: candInfo.width, height: candInfo.height },
    { bitDepth: 8 },
  ).mssim;
  return { psnr, ssim: ssimValue };
}

async function buildQaComposite({
  sourceBuffer,
  orientationInfo,
  bleedPerSidePt,
  pageWidthPt,
  pageHeightPt,
  imageWidthPt,
  imageHeightPt,
  background,
  qaGeometry,
}) {
  const backgroundColor = normalizeHexColor(background);
  const { r, g, b } = hexToRgb01(backgroundColor);
  const density = qaGeometry?.density ?? QA_BASE_DENSITY;
  const pageWidthPx = qaGeometry?.pageWidthPx ?? Math.max(1, Math.round((pageWidthPt / 72) * density));
  const pageHeightPx = qaGeometry?.pageHeightPx ?? Math.max(1, Math.round((pageHeightPt / 72) * density));
  const imageWidthPx = Math.max(1, Math.round((imageWidthPt / 72) * density));
  const imageHeightPx = Math.max(1, Math.round((imageHeightPt / 72) * density));
  const xOffsetPx = Math.round((bleedPerSidePt / 72) * density);
  const yOffsetPx = Math.round((bleedPerSidePt / 72) * density);

  const oriented = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: orientationInfo.widthPx, height: orientationInfo.heightPx, fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const orientedPng = await sharp(oriented.data, {
    raw: {
      width: orientationInfo.widthPx,
      height: orientationInfo.heightPx,
      channels: oriented.info.channels,
    },
  })
    .resize({ width: imageWidthPx, height: imageHeightPx, fit: "fill" })
    .png()
    .toBuffer();

  const composed = await sharp({
    create: {
      width: pageWidthPx,
      height: pageHeightPx,
      channels: 3,
      background: { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) },
    },
  })
    .composite([{ input: orientedPng, left: xOffsetPx, top: yOffsetPx }])
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  return composed;
}

async function ensureIccProfile({ enforceSRGB, embeddedIcc }) {
  if (!enforceSRGB) {
    return { buffer: embeddedIcc || null, source: embeddedIcc ? "embedded" : null, name: null };
  }
  if (embeddedIcc) {
    return { buffer: embeddedIcc, source: "image", name: "embedded" };
  }
  const profile = await loadSrgbProfile();
  return { buffer: profile, source: "srgb", name: "sRGB IEC61966-2.1" };
}

function buildOutputIntent(pdfDoc, iccBuffer, name) {
  if (!iccBuffer) return null;
  const iccStream = pdfDoc.context.register(
    pdfDoc.context.stream(iccBuffer, {
      N: 3,
      Alternate: PDFName.of("DeviceRGB"),
    }),
  );

  const intentDict = pdfDoc.context.obj({
    Type: PDFName.of("OutputIntent"),
    S: PDFName.of("GTS_PDFA1"),
    OutputConditionIdentifier: PDFHexString.fromText(name || "sRGB IEC61966-2.1"),
    Info: PDFHexString.fromText(name || "sRGB IEC61966-2.1"),
    DestOutputProfile: iccStream,
  });
  const arr = pdfDoc.context.obj([intentDict]);
  pdfDoc.catalog.set(PDFName.of("OutputIntents"), arr);
  return { iccStream, name: name || "sRGB IEC61966-2.1" };
}

export async function imageBufferToPdf({
  buffer,
  background,
  bleedCm,
  widthCm,
  heightCm,
  targetPpi,
  allowLossy = false,
  enforceSRGB = true,
  upscale = false,
  maxPixels = MAX_DEFAULT_PIXELS,
  density,
  bleedColor,
  title,
  creator,
} = {}) {
  if (!isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("invalid_image_buffer");
    error.code = "invalid_image_buffer";
    throw error;
  }

  const baseImage = sharp(buffer, { unlimited: true });
  const metadata = await baseImage.metadata();
  if (!metadata?.width || !metadata?.height) {
    const error = new Error("image_metadata_unavailable");
    error.code = "image_metadata_unavailable";
    throw error;
  }

  if (metadata.width * metadata.height > maxPixels) {
    const error = new Error("image_too_large");
    error.code = "image_too_large";
    error.details = { width: metadata.width, height: metadata.height, maxPixels };
    throw error;
  }

  const orientation = metadata.orientation || 1;
  const orientationInfo = getOrientationInfo(orientation, metadata.width, metadata.height);

  const normalizedBackground = normalizeHexColor(background ?? bleedColor ?? DEFAULT_BACKGROUND);
  const bleedPerSideCm = clampBleedCm(bleedCm ?? DEFAULT_BLEED_CM / 2);
  const bleedPerSidePt = cmToPoints(bleedPerSideCm);

  const baseWidthCm = toFiniteNumber(widthCm);
  const baseHeightCm = toFiniteNumber(heightCm);

  let effectiveTargetPpi = toFiniteNumber(targetPpi ?? density, null);
  if (!effectiveTargetPpi || effectiveTargetPpi < 1) {
    effectiveTargetPpi = DEFAULT_TARGET_PPI;
  }

  let imageWidthPt;
  let imageHeightPt;
  let pageWidthPt;
  let pageHeightPt;
  let actualWidthCm = baseWidthCm;
  let actualHeightCm = baseHeightCm;

  if (baseWidthCm && baseHeightCm) {
    imageWidthPt = cmToPoints(baseWidthCm);
    imageHeightPt = cmToPoints(baseHeightCm);
    pageWidthPt = cmToPoints(baseWidthCm + bleedPerSideCm * 2);
    pageHeightPt = cmToPoints(baseHeightCm + bleedPerSideCm * 2);
  } else {
    const pxToPt = 72 / effectiveTargetPpi;
    imageWidthPt = orientationInfo.widthPx * pxToPt;
    imageHeightPt = orientationInfo.heightPx * pxToPt;
    pageWidthPt = imageWidthPt + bleedPerSidePt * 2;
    pageHeightPt = imageHeightPt + bleedPerSidePt * 2;
    actualWidthCm = (imageWidthPt / 72) * CM_PER_INCH;
    actualHeightCm = (imageHeightPt / 72) * CM_PER_INCH;
  }

  const pdfDoc = await PDFDocument.create({ updateMetadata: true });
  if (title) pdfDoc.setTitle(String(title));
  pdfDoc.setAuthor("MgM Gamers");
  pdfDoc.setCreator(creator ? String(creator) : "MgM Print Pipeline");
  pdfDoc.setProducer("MgM Print Pipeline");
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());

  let workingBuffer = buffer;
  let embeddedFormat = metadata.format || "unknown";
  let recompression = false;

  if (!['jpeg', 'png'].includes(embeddedFormat)) {
    const converted = await sharp(buffer)
      .png({ compressionLevel: 0, effort: 1 })
      .toBuffer();
    workingBuffer = converted;
    embeddedFormat = 'png';
    recompression = true;
  }

  if (embeddedFormat === 'jpeg' && metadata.hasAlpha) {
    workingBuffer = await sharp(buffer)
      .png({ compressionLevel: 0, effort: 1 })
      .toBuffer();
    embeddedFormat = 'png';
    recompression = true;
  }

  const iccProfileBuffer = metadata.icc ? Buffer.from(metadata.icc) : null;
  const iccProfile = await ensureIccProfile({ enforceSRGB, embeddedIcc: iccProfileBuffer });
  const outputIntent = iccProfile.buffer ? buildOutputIntent(pdfDoc, iccProfile.buffer, iccProfile.name) : null;

  let embeddedImage;
  if (embeddedFormat === 'jpeg') {
    embeddedImage = await pdfDoc.embedJpg(workingBuffer);
  } else {
    embeddedImage = await pdfDoc.embedPng(workingBuffer);
  }

  if (outputIntent?.iccStream) {
    const imageObject = pdfDoc.context.lookup(embeddedImage.ref);
    const dict = imageObject?.dict;
    if (dict?.set) {
      const array = PDFArray.withContext(pdfDoc.context);
      array.push(PDFName.of('ICCBased'));
      array.push(outputIntent.iccStream);
      dict.set(PDFName.of('ColorSpace'), array);
    }
  }

  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  const backgroundColorRgb = hexToRgb01(normalizedBackground);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidthPt,
    height: pageHeightPt,
    color: rgb(backgroundColorRgb.r, backgroundColorRgb.g, backgroundColorRgb.b),
  });

  const offsetX = bleedPerSidePt;
  const offsetY = bleedPerSidePt;
  let drawX = offsetX;
  let drawY = offsetY;
  let drawWidth = imageWidthPt;
  let drawHeight = imageHeightPt;
  let rotationDeg = 0;

  switch (orientationInfo.transform) {
    case 'mirror-horizontal':
      drawX = offsetX + imageWidthPt;
      drawWidth = -imageWidthPt;
      break;
    case 'mirror-vertical':
      drawY = offsetY + imageHeightPt;
      drawHeight = -imageHeightPt;
      break;
    case 'rotate-180':
      rotationDeg = 180;
      drawX = offsetX + imageWidthPt;
      drawY = offsetY + imageHeightPt;
      break;
    case 'rotate-90':
      rotationDeg = -90;
      drawX = offsetX;
      drawY = offsetY + imageWidthPt;
      drawWidth = imageHeightPt;
      drawHeight = imageWidthPt;
      break;
    case 'rotate-270':
      rotationDeg = 90;
      drawX = offsetX + imageHeightPt;
      drawY = offsetY;
      drawWidth = imageHeightPt;
      drawHeight = imageWidthPt;
      break;
    case 'transpose':
      rotationDeg = 90;
      drawX = offsetX + imageHeightPt;
      drawY = offsetY;
      drawWidth = -imageHeightPt;
      drawHeight = imageWidthPt;
      break;
    case 'transverse':
      rotationDeg = -90;
      drawX = offsetX;
      drawY = offsetY + imageWidthPt;
      drawWidth = -imageHeightPt;
      drawHeight = imageWidthPt;
      break;
    case 'identity':
    default:
      break;
  }

  page.drawImage(embeddedImage, {
    x: drawX,
    y: drawY,
    width: drawWidth,
    height: drawHeight,
    rotate: degrees(rotationDeg),
  });

  const pdfBytes = await pdfDoc.save({
    useObjectStreams: false,
  });

  const pdfBuffer = Buffer.from(pdfBytes);

  if (pdfBuffer.length > PDF_SIZE_LIMIT_BYTES && !allowLossy) {
    const error = new Error('pdf_too_large');
    error.code = 'pdf_too_large';
    error.size = pdfBuffer.length;
    error.limit = PDF_SIZE_LIMIT_BYTES;
    throw error;
  }

  let jpegStreamMatches = null;
  if (embeddedFormat === 'jpeg' && !recompression) {
    jpegStreamMatches = buffer.equals(workingBuffer);
    if (!jpegStreamMatches) {
      const error = new Error('jpeg_stream_mismatch');
      error.code = 'jpeg_stream_mismatch';
      throw error;
    }
  }

  const qaGeometry = computeQaGeometry(pageWidthPt, pageHeightPt);

  const referenceRaster = await buildQaComposite({
    sourceBuffer: buffer,
    orientationInfo,
    bleedPerSidePt,
    pageWidthPt,
    pageHeightPt,
    imageWidthPt,
    imageHeightPt,
    background: normalizedBackground,
    qaGeometry,
  });

  const embeddedRaster = await buildQaComposite({
    sourceBuffer: workingBuffer,
    orientationInfo,
    bleedPerSidePt,
    pageWidthPt,
    pageHeightPt,
    imageWidthPt,
    imageHeightPt,
    background: normalizedBackground,
    qaGeometry,
  });

  const qaMetrics = computePsnrAndSsim(referenceRaster, embeddedRaster);
  const qaExtended = { ...qaMetrics, jpeg_stream_match: jpegStreamMatches };
  const qaOk = (qaMetrics.psnr == null || qaMetrics.psnr === Infinity || qaMetrics.psnr >= 45)
    && (qaMetrics.ssim == null || qaMetrics.ssim >= 0.99);
  if (!qaOk) {
    const error = new Error('qa_check_failed');
    error.code = 'qa_check_failed';
    error.details = qaMetrics;
    throw error;
  }

  const widthInches = actualWidthCm != null ? actualWidthCm / CM_PER_INCH : (imageWidthPt / 72);
  const heightInches = actualHeightCm != null ? actualHeightCm / CM_PER_INCH : (imageHeightPt / 72);
  const actualPpiWidth = widthInches > 0 ? orientationInfo.widthPx / widthInches : null;
  const actualPpiHeight = heightInches > 0 ? orientationInfo.heightPx / heightInches : null;

  const diagnostics = {
    orig_px: { width: metadata.width, height: metadata.height },
    oriented_px: { width: orientationInfo.widthPx, height: orientationInfo.heightPx },
    page_pts: { width: pageWidthPt, height: pageHeightPt },
    bleed_cm: bleedPerSideCm,
    embedded_format: embeddedFormat,
    icc: iccProfile.source || null,
    recompression,
    qa: qaExtended,
    target_ppi: effectiveTargetPpi,
    actual_ppi: { width: actualPpiWidth, height: actualPpiHeight },
    qa_density: qaGeometry.density,
  };

  console.info('image_to_pdf_result', diagnostics);

  return {
    pdfBuffer,
    widthPx: orientationInfo.widthPx,
    heightPx: orientationInfo.heightPx,
    widthCm: actualWidthCm,
    heightCm: actualHeightCm,
    widthCmPrint: (actualWidthCm != null ? actualWidthCm + bleedPerSideCm * 2 : null),
    heightCmPrint: (actualHeightCm != null ? actualHeightCm + bleedPerSideCm * 2 : null),
    pageWidthPt,
    pageHeightPt,
    bleedCm: bleedPerSideCm,
    embeddedFormat,
    iccProfile: iccProfile.source,
    recompression,
    qa: qaExtended,
    targetPpi: effectiveTargetPpi,
    diagnostics,
    qaDensity: qaGeometry.density,
  };
}

export default imageBufferToPdf;
