import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import imageBufferToPdf from '../lib/_lib/imageToPdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

function createGradientBuffer(width, height) {
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * channels;
      buffer[idx] = Math.round((x / Math.max(1, width - 1)) * 255);
      buffer[idx + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      buffer[idx + 2] = Math.round(((x + y) / Math.max(1, width + height - 2)) * 255);
    }
  }
  return buffer;
}

test('imageBufferToPdf generates printable PDF from PNG', async () => {
  await ensureOutputDir();
  const widthPx = 1800;
  const heightPx = 1200;
  const raw = createGradientBuffer(widthPx, heightPx);
  const pngBuffer = await sharp(raw, {
    raw: {
      width: widthPx,
      height: heightPx,
      channels: 3,
    },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();

  const result = await imageBufferToPdf({
    buffer: pngBuffer,
    widthCm: 90,
    heightCm: 60,
    bleedCm: 1,
    background: '#ffffff',
    title: 'Test Gradient PDF',
  });

  assert.ok(result.pdfBuffer.length > 0, 'pdfBuffer must not be empty');
  assert.equal(result.widthCm, 90);
  assert.equal(result.heightCm, 60);
  assert.equal(result.widthCmPrint, 92);
  assert.equal(result.heightCmPrint, 62);
  assert.ok(result.widthPx > 0);
  assert.ok(result.heightPx > 0);
  assert.ok(result.density >= 300);

  const pdfPath = path.join(OUTPUT_DIR, 'gradient-90x60cm.pdf');
  await fs.writeFile(pdfPath, result.pdfBuffer);
  const stats = await fs.stat(pdfPath);
  assert.equal(stats.size, result.pdfBuffer.length);

  console.info('image_to_pdf_test_example', {
    pdf_path: pdfPath,
    size_bytes: result.pdfBuffer.length,
    diagnostics: {
      target_ppi: result.targetPpi,
      bleed_cm: result.bleedCm,
    },
  });
});

test('imageBufferToPdf handles EXIF-oriented JPEG input', async () => {
  const widthPx = 1024;
  const heightPx = 1536;
  const raw = createGradientBuffer(widthPx, heightPx);
  const jpegBuffer = await sharp(raw, {
    raw: {
      width: widthPx,
      height: heightPx,
      channels: 3,
    },
  })
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const result = await imageBufferToPdf({
    buffer: jpegBuffer,
    bleedCm: 1,
    targetPpi: 150,
    background: '#fdfdfd',
    title: 'Orientation 6 Test',
  });

  assert.ok(result.pdfBuffer.length > 0);
  assert.equal(result.widthPx, widthPx);
  assert.equal(result.heightPx, heightPx);
  assert.ok(result.density >= 300);
});
