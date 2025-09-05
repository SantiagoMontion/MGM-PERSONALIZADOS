import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

// Palabras clave de odio/racismo (minúsculas)
const HATE_WORDS = [
  'nazi',
  'swastika',
  'esvastica',
  'hitler',
  'kkk',
  'heil',
  'ss-totenkopf',
  'white power',
  'wpww',
  '1488',
  '14/88',
  'sieg heil'
];

async function dHash(buffer) {
  const { data } = await sharp(buffer)
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idxL = y * 9 + x;
      const idxR = y * 9 + x + 1;
      bits += data[idxL] < data[idxR] ? '1' : '0';
    }
  }
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

function hamming(a, b) {
  const x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0n,
    y = x;
  while (y) {
    n += y & 1n;
    y >>= 1n;
  }
  return Number(n);
}

// Plantillas dHash calculadas desde assets/mod-templates/swastika/*.png
const SWASTIKA_HASHES = [
  '26cecdcfcccc4c48', // base
  '4d96330f8e178e4d', // rot45
  '808c4c0ccccccd2d', // rot90
  '49b2334d4d33b249', // rot135
  '2dcdcccc0c4c8c80', // rot180
  '4d8e178e0f33964d', // rot225
  '484ccccccfcdce26' // rot270
];

async function looksLikeSwastika(buffer) {
  const hash = await dHash(buffer);
  return SWASTIKA_HASHES.some((h) => hamming(hash, h) <= 10);
}

async function ocrHate(buffer) {
  const worker = await createWorker('eng', 1, { gzip: false });
  try {
    const {
      data: { text }
    } = await worker.recognize(buffer);
    const t = (text || '').toLowerCase();
    return HATE_WORDS.some((w) => t.includes(w));
  } finally {
    await worker.terminate();
  }
}

export async function checkHate(buffer, filename = '') {
  const name = (filename || '').toLowerCase();
  if (HATE_WORDS.some((w) => name.includes(w))) return { block: true, reason: 'filename' };

  let hasText = false;
  try {
    hasText = await ocrHate(buffer);
  } catch (_) {
    /* ignore OCR failure */
  }
  if (hasText) return { block: true, reason: 'ocr' };

  let looks = false;
  try {
    looks = await looksLikeSwastika(buffer);
  } catch (_) {
    /* ignore */
  }
  return { block: looks, reason: looks ? 'template' : null };
}

