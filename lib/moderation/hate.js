import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

// --- Normalización texto ---
const LEET = new Map(Object.entries({ '0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b' }));
export function normalizeText(s = '') {
  s = s.normalize('NFKD').toLowerCase();
  s = s.replace(/[\u0300-\u036f]/g, ''); // quitar diacríticos
  s = s.replace(/[^a-z0-9]+/g, ''); // quitar espacios/puntuación
  s = s.replace(/[0134578]/g, (c) => LEET.get(c) || c); // leet básico
  s = s.replace(/(.)\1+/g, '$1'); // colapsar repeticiones
  return s;
}

export const HATE_WORDS = [
  'nazi','swastika','esvastica','siegheil','heilhitler','hitler','kkk',
  'whitepower','wpww','1488','14','88','schutzstaffel','ss'
];

// --- OCR (worker cacheado) ---
let _worker;
async function getWorker() {
  if (_worker) return _worker;
  _worker = await createWorker('eng+deu+spa', 1, { gzip: false });
  return _worker;
}
export async function ocrHasHate(buffer, timeout = 5000) {
  try {
    const worker = await getWorker();
    const p = worker.recognize(buffer, { preserve_interword_spaces: 1 });
    const res = await Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
    ]);
    const { data: { text = '' } = {} } = res || {};
    const t = normalizeText(text);
    return HATE_WORDS.some((w) => t.includes(w));
  } catch {
    return false;
  }
}

// --- dHash util ---
async function toGray(buffer, size = 128) {
  return await sharp(buffer)
    .resize(size, size, { fit: 'fill' })
    .grayscale()
    .threshold(128, { grayscale: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
}
function dHashFromRaw({ data, info }) {
  const w = info.width, h = info.height;
  const rx = 9, ry = 8;
  const sx = (w - 1) / (rx - 1), sy = h / ry;
  let bits = '';
  for (let y = 0; y < ry; y++) {
    const yy = Math.min(h - 1, Math.round(y * sy));
    for (let x = 0; x < rx - 1; x++) {
      const xl = Math.min(w - 1, Math.round(x * sx));
      const xr = Math.min(w - 1, Math.round((x + 1) * sx));
      const L = data[yy * w + xl];
      const R = data[yy * w + xr];
      bits += L < R ? '1' : '0';
    }
  }
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
export function hamming(a, b) {
  const x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0n, y = x;
  while (y) {
    n += y & 1n;
    y >>= 1n;
  }
  return Number(n);
}

// --- Plantillas en memoria (SVG -> raster -> dHash) ---
let TEMPLATE_HASHES = null;

function swastikaSVG({ size = 128, stroke = 18, invert = false, rotate = 0 }) {
  const s = size, m = s / 2;
  const c = invert ? '#fff' : '#000';
  const bg = invert ? '#000' : '#fff';
  return `\n<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">\n  <rect width="100%" height="100%" fill="${bg}"/>\n  <g transform="rotate(${rotate}, ${m}, ${m})" fill="${c}">\n    <rect x="${m - stroke/2}" y="${m - s*0.35}" width="${stroke}" height="${s*0.7}"/>\n    <rect x="${m - s*0.35}" y="${m - stroke/2}" width="${s*0.7}" height="${stroke}"/>\n    <!-- codos -->\n    <rect x="${m + stroke*0.5}" y="${m - s*0.35}" width="${s*0.2}" height="${stroke}"/>\n    <rect x="${m - stroke/2}" y="${m + stroke*0.5}" width="${stroke}" height="${s*0.2}"/>\n    <rect x="${m - s*0.35}" y="${m - stroke*0.5 - s*0.2}" width="${s*0.2}" height="${stroke}"/>\n    <rect x="${m - stroke*0.5 - s*0.2}" y="${m - stroke/2}" width="${stroke}" height="${s*0.2}"/>\n  </g>\n</svg>`;
}

async function svgToHash(svg) {
  const buf = Buffer.from(svg);
  const png = await sharp(buf).toBuffer();
  const raw = await toGray(png, 128);
  return dHashFromRaw(raw);
}

export async function initHateTemplates() {
  if (TEMPLATE_HASHES) return TEMPLATE_HASHES;
  const rotations = [0, 45, 90, 135];
  const strokes = [10, 16, 22, 28];
  const inverses = [false, true];
  const tasks = [];
  for (const r of rotations) {
    for (const st of strokes) {
      for (const inv of inverses) {
        tasks.push(svgToHash(swastikaSVG({ rotate: r, stroke: st, invert: inv })));
      }
    }
  }
  const hashes = await Promise.all(tasks);
  TEMPLATE_HASHES = Array.from(new Set(hashes));
  return TEMPLATE_HASHES;
}

export async function looksLikeSwastika(buffer, threshold = 18) {
  const raw = await toGray(buffer, 128);
  const hash = dHashFromRaw(raw);
  const templates = await initHateTemplates();
  return templates.some((h) => hamming(hash, h) <= threshold);
}

export async function checkHate(buffer, filename = '') {
  const nameN = normalizeText(filename);
  if (HATE_WORDS.some((w) => nameN.includes(w))) {
    return { block: true, reason: 'filename' };
  }

  let hasText = false;
  try {
    hasText = await ocrHasHate(buffer);
  } catch {}
  if (hasText) return { block: true, reason: 'ocr' };

  let looks = false;
  try {
    looks = await looksLikeSwastika(buffer, 18);
  } catch {}
  if (looks) return { block: true, reason: 'template' };

  return { block: false, reason: null };
}

export default { checkHate, initHateTemplates };
