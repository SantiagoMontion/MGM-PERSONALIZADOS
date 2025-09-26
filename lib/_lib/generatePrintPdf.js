import sharp from 'sharp';

const CM_PER_INCH = 2.54;
const DEFAULT_DPI = 300;
const MARGIN_CM = 2;

function cmToPixels(valueCm) {
  const numeric = Number(valueCm);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('invalid_dimension');
  }
  return Math.max(1, Math.round((numeric / CM_PER_INCH) * DEFAULT_DPI));
}

function normalizeColor(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '#ffffff';
  const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!hexMatch) return '#ffffff';
  const [, value] = hexMatch;
  if (value.length === 3) {
    return `#${value.split('').map((ch) => ch + ch).join('')}`;
  }
  return `#${value}`;
}

export async function generatePrintPdf({
  widthCm,
  heightCm,
  backgroundColor,
  imageBuffer,
}) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    const error = new Error('invalid_image_buffer');
    error.code = 'invalid_image_buffer';
    throw error;
  }

  const areaWidthCm = Number(widthCm);
  const areaHeightCm = Number(heightCm);
  if (!Number.isFinite(areaWidthCm) || areaWidthCm <= 0) {
    const error = new Error('invalid_width_cm');
    error.code = 'invalid_width_cm';
    throw error;
  }
  if (!Number.isFinite(areaHeightCm) || areaHeightCm <= 0) {
    const error = new Error('invalid_height_cm');
    error.code = 'invalid_height_cm';
    throw error;
  }

  const pageWidthCm = areaWidthCm + MARGIN_CM * 2;
  const pageHeightCm = areaHeightCm + MARGIN_CM * 2;

  const pageWidthPx = cmToPixels(pageWidthCm);
  const pageHeightPx = cmToPixels(pageHeightCm);
  const marginPx = cmToPixels(MARGIN_CM);
  const areaWidthPx = pageWidthPx - marginPx * 2;
  const areaHeightPx = pageHeightPx - marginPx * 2;

  const normalizedColor = normalizeColor(backgroundColor);

  let artworkBuffer;
  let artworkMetadata;
  try {
    const pipeline = sharp(imageBuffer)
      .rotate()
      .resize({
        width: areaWidthPx,
        height: areaHeightPx,
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      })
      .png();
    artworkBuffer = await pipeline.toBuffer();
    artworkMetadata = await sharp(artworkBuffer).metadata();
  } catch (err) {
    const error = new Error('artwork_processing_failed');
    error.code = 'artwork_processing_failed';
    error.cause = err;
    throw error;
  }

  const artworkWidthPx = Math.min(areaWidthPx, artworkMetadata?.width || areaWidthPx);
  const artworkHeightPx = Math.min(areaHeightPx, artworkMetadata?.height || areaHeightPx);
  const offsetLeft = Math.round(marginPx + Math.max(0, (areaWidthPx - artworkWidthPx) / 2));
  const offsetTop = Math.round(marginPx + Math.max(0, (areaHeightPx - artworkHeightPx) / 2));

  let pdfBuffer;
  try {
    const canvas = sharp({
      create: {
        width: pageWidthPx,
        height: pageHeightPx,
        channels: 3,
        background: normalizedColor,
      },
    });
    pdfBuffer = await canvas
      .composite([
        {
          input: artworkBuffer,
          left: offsetLeft,
          top: offsetTop,
        },
      ])
      .withMetadata({ density: DEFAULT_DPI })
      .toFormat('pdf')
      .toBuffer();
  } catch (err) {
    const error = new Error('pdf_generation_failed');
    error.code = 'pdf_generation_failed';
    error.cause = err;
    throw error;
  }

  return {
    buffer: pdfBuffer,
    info: {
      pageWidthCm,
      pageHeightCm,
      marginCm: MARGIN_CM,
      dpi: DEFAULT_DPI,
      area: {
        widthCm: areaWidthCm,
        heightCm: areaHeightCm,
        widthPx: areaWidthPx,
        heightPx: areaHeightPx,
      },
      artwork: {
        widthPx: artworkWidthPx,
        heightPx: artworkHeightPx,
      },
      backgroundColor: normalizedColor,
    },
  };
}

export default generatePrintPdf;
