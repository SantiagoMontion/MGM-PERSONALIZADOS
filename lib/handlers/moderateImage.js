import sharp from 'sharp';
import { pHashFromGray, hamming } from '../hashing.js';
import { hateTextCheck } from '../moderation/hate.js';
import logger from '../_lib/logger.js';
import { applyCorsHeaders } from '../cors.js';

const MOD_PREVIEW_LIMIT_BYTES = Number(process.env.MOD_PREVIEW_LIMIT_BYTES ?? 2_000_000);
const DEFAULT_FRONT_ORIGIN = 'https://mgm-app.vercel.app';

function sanitizeOrigin(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

function normalizeOrigin(value) {
  const sanitized = sanitizeOrigin(value);
  return sanitized ? sanitized.toLowerCase() : null;
}

function getAllowedOrigins() {
  const allowList = new Map();
  const frontOrigin = sanitizeOrigin(process.env.FRONT_ORIGIN) || DEFAULT_FRONT_ORIGIN;
  const normalizedFront = normalizeOrigin(frontOrigin);
  if (normalizedFront) {
    allowList.set(normalizedFront, frontOrigin);
  }

  const extra = typeof process.env.ALLOWED_ORIGINS === 'string'
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [];
  for (const candidate of extra) {
    const sanitized = sanitizeOrigin(candidate);
    const normalized = normalizeOrigin(candidate);
    if (sanitized && normalized) {
      allowList.set(normalized, sanitized);
    }
  }

  return allowList;
}

function resolveAllowedOrigin(req) {
  const requested = sanitizeOrigin(req?.headers?.origin);
  const normalizedRequested = normalizeOrigin(requested);
  const allowList = getAllowedOrigins();
  if (normalizedRequested && allowList.has(normalizedRequested)) {
    return allowList.get(normalizedRequested);
  }
  if (normalizedRequested && (normalizedRequested.startsWith('http://localhost') || normalizedRequested.startsWith('http://127.0.0.1'))) {
    return requested;
  }
  const first = allowList.values().next();
  if (!first.done && first.value) {
    return first.value;
  }
  return sanitizeOrigin(process.env.FRONT_ORIGIN) || DEFAULT_FRONT_ORIGIN;
}

function applyCors(req, res) {
  const origin = resolveAllowedOrigin(req);
  applyCorsHeaders(req, res, origin);
}

function sendJson(req, res, statusCode, payload) {
  applyCors(req, res);
  if (typeof res.status === 'function') {
    res.status(statusCode);
  } else {
    res.statusCode = statusCode;
  }
  const body = payload == null ? {} : payload;
  if (typeof res.json === 'function' && res.json !== sendJson) {
    res.json(body);
    return;
  }
  try {
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  } catch {}
  res.end(JSON.stringify(body));
}

const SKIP_OCR = process.env.MODERATION_SKIP_OCR === '1';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const NAZI_BLOCK_THRESHOLD = 0.6;
const PERSON_SCORE_THRESHOLD = 0.4;
const REAL_PERSON_THRESHOLD = 0.7;
const GENITALS_THRESHOLD = 0.8;
const AREOLA_THRESHOLD = 0.85;
const SEX_ACT_THRESHOLD = 0.75;
const BUTT_EXPOSED_THRESHOLD = 0.8;
const VISIBLE_AREA_RATIO_MIN = 0.03;
const MINOR_BLOCK_THRESHOLD = 0.5;
const MINOR_REVIEW_THRESHOLD = 0.4;
const IGNORE_DETECTION_CONFIDENCE_BELOW = 0.6;
const REVIEW_MARGIN = 0.05;

function toBufferFromDataUrl(dataUrl) {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return Buffer.from(m[2], 'base64');
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

let tesseractModulePromise = null;
async function loadTesseract() {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import('tesseract.js').catch((err) => {
      tesseractModulePromise = null;
      throw err;
    });
  }
  return tesseractModulePromise;
}

async function extractTextHints(buffer) {
  if (SKIP_OCR) return '';
  try {
    const { default: Tesseract } = await loadTesseract();
    const prepped = await sharp(buffer)
      .removeAlpha()
      .grayscale()
      .normalize()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    const result = await Tesseract.recognize(prepped, 'eng', { logger: () => {} });
    const text = result?.data?.text || '';
    return text.replace(/\s+/g, ' ').trim();
  } catch (err) {
    return '';
  }
}

async function detectSkin(buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .resize({ width: 256, withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const total = w * h;
  const mask = new Uint8Array(total);
  let skinCount = 0;
  const centerMarginX = Math.floor(w * 0.2);
  const centerMarginY = Math.floor(h * 0.2);
  const cx0 = centerMarginX;
  const cx1 = w - centerMarginX;
  const cy0 = centerMarginY;
  const cy1 = h - centerMarginY;
  let centerTotal = 0;
  let centerSkin = 0;
  const skinToneSamples = [];

  for (let i = 0, p = 0; p < total; i += info.channels, p++) {
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const Y = 0.299 * R + 0.587 * G + 0.114 * B;
    const Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
    const Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
    const isSkin = Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173;
    const x = p % w;
    const y = Math.floor(p / w);
    const inCenter = x >= cx0 && x < cx1 && y >= cy0 && y < cy1;
    if (inCenter) centerTotal++;
    if (isSkin) {
      mask[p] = 1;
      skinCount++;
      if (inCenter) centerSkin++;
      skinToneSamples.push({ Y, Cb, Cr });
    }
  }

  // largest connected component (4-neigh)
  const vis = new Uint8Array(total);
  let maxBlob = 0;
  let secondBlob = 0;
  let maxBlobBox = null;
  let maxBlobCenterHits = 0;
  const qx = new Int32Array(total);
  const qy = new Int32Array(total);
  for (let p = 0; p < total; p++) {
    if (!mask[p] || vis[p]) continue;
    let head = 0;
    let tail = 0;
    qx[tail] = p % w;
    qy[tail] = Math.floor(p / w);
    tail++;
    vis[p] = 1;
    let area = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    let centerHits = 0;
    while (head < tail) {
      const x = qx[head];
      const y = qy[head];
      head++;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) centerHits++;
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (mask[np] && !vis[np]) {
          vis[np] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
    }
    if (area > maxBlob) {
      secondBlob = maxBlob;
      maxBlob = area;
      maxBlobBox = { minX, maxX, minY, maxY };
      maxBlobCenterHits = centerHits;
    } else if (area > secondBlob) {
      secondBlob = area;
    }
  }

  const centerSkinPercent = centerTotal ? centerSkin / centerTotal : 0;
  const largestBlobBoxArea = maxBlobBox
    ? (maxBlobBox.maxX - maxBlobBox.minX + 1) * (maxBlobBox.maxY - maxBlobBox.minY + 1)
    : 0;
  const largestBlobBoxCoverage = maxBlobBox && total ? largestBlobBoxArea / total : 0;
  const largestBlob = total ? maxBlob / total : 0;
  const secondLargestBlob = total ? secondBlob / total : 0;
  const largestBlobCenterRatio = maxBlob ? maxBlobCenterHits / maxBlob : 0;

  let toneVariance = 0;
  if (skinToneSamples.length > 1) {
    let sumCb = 0;
    let sumCr = 0;
    for (const sample of skinToneSamples) {
      sumCb += sample.Cb;
      sumCr += sample.Cr;
    }
    const meanCb = sumCb / skinToneSamples.length;
    const meanCr = sumCr / skinToneSamples.length;
    let varCb = 0;
    let varCr = 0;
    for (const sample of skinToneSamples) {
      const dCb = sample.Cb - meanCb;
      const dCr = sample.Cr - meanCr;
      varCb += dCb * dCb;
      varCr += dCr * dCr;
    }
    toneVariance = Math.sqrt((varCb + varCr) / (skinToneSamples.length - 1)) / 100;
  }

  return {
    skinPercent: total ? skinCount / total : 0,
    largestBlob,
    secondLargestBlob,
    centerSkinPercent,
    largestBlobBoxCoverage,
    largestBlobCenterRatio,
    toneVariance,
  };
}

async function detectIllustration(buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const total = width * height;
  const palette = new Set();
  let edgeCount = 0;
  let comparisons = 0;
  const diffThreshold = 110;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const R = data[idx];
      const G = data[idx + 1];
      const B = data[idx + 2];
      const key = ((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3);
      palette.add(key);

      if (x + 1 < width) {
        const idxR = idx + channels;
        const diff = Math.abs(R - data[idxR]) + Math.abs(G - data[idxR + 1]) + Math.abs(B - data[idxR + 2]);
        if (diff > diffThreshold) edgeCount++;
        comparisons++;
      }
      if (y + 1 < height) {
        const idxB = idx + width * channels;
        const diff = Math.abs(R - data[idxB]) + Math.abs(G - data[idxB + 1]) + Math.abs(B - data[idxB + 2]);
        if (diff > diffThreshold) edgeCount++;
        comparisons++;
      }
    }
  }

  const paletteRatio = palette.size / total;
  const edgeRatio = comparisons ? edgeCount / comparisons : 0;
  const paletteScore = clamp((0.5 - paletteRatio) / 0.4);
  const edgeScore = clamp((edgeRatio - 0.12) / 0.28);
  const cartoonConfidence = clamp(paletteScore * 0.6 + edgeScore * 0.4);

  return { paletteSize: palette.size, totalPixels: total, paletteRatio, edgeRatio, cartoonConfidence };
}

function swastikaSVG({ size = 64, stroke = 10, invert = false, rotate = 0, flag = false }) {
  const s = size, m = s / 2;
  const c = invert ? '#fff' : '#000';
  const bg = invert ? '#000' : (flag ? '#c00' : '#fff');
  const circle = flag ? `<circle cx="${m}" cy="${m}" r="${s*0.28}" fill="#fff" stroke="#000" stroke-width="${Math.max(2, s*0.05)}"/>` : '';
  return `\n<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">\n  <rect width="100%" height="100%" fill="${bg}"/>\n  ${circle}\n  <g transform="rotate(${rotate}, ${m}, ${m})" fill="${c}">\n    <rect x="${m - stroke/2}" y="${m - s*0.35}" width="${stroke}" height="${s*0.7}"/>\n    <rect x="${m - s*0.35}" y="${m - stroke/2}" width="${s*0.7}" height="${stroke}"/>\n    <rect x="${m + stroke*0.5}" y="${m - s*0.35}" width="${s*0.2}" height="${stroke}"/>\n    <rect x="${m - stroke/2}" y="${m + stroke*0.5}" width="${stroke}" height="${s*0.2}"/>\n    <rect x="${m - s*0.35}" y="${m - stroke*0.5 - s*0.2}" width="${s*0.2}" height="${stroke}"/>\n    <rect x="${m - stroke*0.5 - s*0.2}" y="${m - stroke/2}" width="${stroke}" height="${s*0.2}"/>\n  </g>\n</svg>`;
}

let TEMPLATES = null;
async function getTemplates() {
  if (TEMPLATES) return TEMPLATES;
  const templates = [];
  const rotations = [0, 45, 90, 135];
  const strokes = [8, 10, 12];
  for (const r of rotations) {
    for (const st of strokes) {
      templates.push({ rotation: r, svg: swastikaSVG({ rotate: r, stroke: st, invert: false, flag: false }) });
    }
  }
  // flags variants (retain rotation metadata for palette heuristics)
  for (const r of [0]) {
    for (const st of [10]) {
      templates.push({ rotation: r, svg: swastikaSVG({ rotate: r, stroke: st, invert: false, flag: true }) });
    }
  }
  const hashes = [];
  for (const tpl of templates) {
    const buf = Buffer.from(tpl.svg);
    const { data, info } = await sharp(buf).resize(64, 64).grayscale().raw().toBuffer({ resolveWithObject: true });
    const hash = pHashFromGray(data, info.width, info.height);
    hashes.push({ hash, rotation: tpl.rotation });
  }
  TEMPLATES = hashes;
  return TEMPLATES;
}

async function detectNazi(buffer) {
  const image = sharp(buffer).removeAlpha();
  const { data, info } = await image.resize(64, 64).grayscale().raw().toBuffer({ resolveWithObject: true });
  const hash = pHashFromGray(data, info.width, info.height);
  const tmpls = await getTemplates();
  let minDist = Infinity;
  let bestRotation = 0;
  for (const tpl of tmpls) {
    const d = hamming(hash, tpl.hash);
    if (d < minDist) {
      minDist = d;
      bestRotation = tpl.rotation;
    }
  }

  const normalized = clamp(1 - Math.max(0, minDist - 6) / 26);
  const rotationFactor = bestRotation % 90 === 45 ? 1 : 0.45;
  const shapeSignal = clamp(normalized * rotationFactor);

  const { data: d2, info: i2 } = await sharp(buffer)
    .removeAlpha()
    .resize({ width: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = i2.width;
  const h = i2.height;
  const total = w * h;
  let redDom = 0;
  let whiteInCircle = 0;
  let blackStroke = 0;
  let inCircleCount = 0;
  let inRingCount = 0;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const r = Math.floor(Math.min(w, h) * 0.3);
  for (let p = 0, idx = 0; p < total; p++, idx += i2.channels) {
    const R = d2[idx];
    const G = d2[idx + 1];
    const B = d2[idx + 2];
    const isRed = R > 200 && G < 90 && B < 90;
    const isWhite = R > 220 && G > 220 && B > 220;
    const isBlack = R < 55 && G < 55 && B < 55;
    if (isRed) {
      redDom++;
    }
    if (isWhite) {
      whiteInCircle++;
    }
    if (isBlack) {
      blackStroke++;
    }
    const x = p % w;
    const y = Math.floor(p / w);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= r) inCircleCount++;
    if (dist > r * 0.85 && dist < r * 1.1) inRingCount++;
  }
  const redRatio = redDom / total;
  const whiteCircleRatio = inCircleCount ? whiteInCircle / inCircleCount : 0;
  const blackStrokeRatio = inRingCount ? blackStroke / inRingCount : 0;

  const redScore = clamp((redRatio - 0.45) / 0.25);
  const whiteScore = clamp((whiteCircleRatio - 0.65) / 0.25);
  const blackScore = clamp((blackStrokeRatio - 0.15) / 0.25);
  const paletteSignal = clamp(redScore * 0.4 + whiteScore * 0.35 + blackScore * 0.25);

  const likelyManji = rotationFactor < 0.7 && paletteSignal < 0.45;

  return {
    shapeSignal,
    paletteSignal,
    minDist,
    rotation: bestRotation,
    palette: { redRatio, whiteCircleRatio, blackStrokeRatio },
    likelyManji,
  };
}

// Ensure the moderation heuristics evaluate at least a medium sized canvas.
const MIN_PADDED_DIMENSION = 512;
// Allow small source images when the effective DPI is acceptable (matches front-end thresholds).
const LOW_RES_MIN_DIMENSION = 256;
const LOW_RES_MIN_APPROX_DPI = 100;

async function prepareModerationImage(buffer) {
  try {
    const originalMeta = await sharp(buffer).metadata();
    let pipeline = sharp(buffer);
    let changed = false;
    let removedAlpha = false;
    let padding = null;

    if (originalMeta?.hasAlpha || (originalMeta?.channels || 0) >= 4) {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
      removedAlpha = true;
      changed = true;
    }

    const width = originalMeta?.width || 0;
    const height = originalMeta?.height || 0;
    if (width && height) {
      const targetWidth = Math.max(width, MIN_PADDED_DIMENSION);
      const targetHeight = Math.max(height, MIN_PADDED_DIMENSION);
      const extraW = targetWidth - width;
      const extraH = targetHeight - height;
      if (extraW > 0 || extraH > 0) {
        const pad = {
          left: Math.floor(extraW / 2),
          right: extraW - Math.floor(extraW / 2),
          top: Math.floor(extraH / 2),
          bottom: extraH - Math.floor(extraH / 2),
        };
        padding = pad;
        pipeline = pipeline.extend({
          ...pad,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        });
        changed = true;
      }
    }

    if (!changed) {
      return {
        buffer,
        meta: originalMeta,
        originalMeta,
        removedAlpha,
        padding,
      };
    }

    const finalBuffer = await pipeline.toBuffer();
    const normalizedMeta = await sharp(finalBuffer).metadata();

    return {
      buffer: finalBuffer,
      meta: normalizedMeta,
      originalMeta,
      removedAlpha,
      padding,
    };
  } catch (err) {
    return {
      buffer,
      meta: null,
      originalMeta: null,
      removedAlpha: false,
      padding: null,
      error: err?.message || String(err),
    };
  }
}

function computeNudityConfidence({
  skinPercent = 0,
  largestBlob = 0,
  secondLargestBlob = 0,
  centerSkinPercent = 0,
  largestBlobBoxCoverage = 0,
  largestBlobCenterRatio = 0,
  toneVariance = 0,
} = {}) {
  const skinScore = clamp((skinPercent - 0.28) / 0.35);
  const blobScore = clamp((largestBlob - 0.12) / 0.28);
  const centerScore = clamp((centerSkinPercent - 0.2) / 0.3);
  const boxScore = clamp((largestBlobBoxCoverage - 0.24) / 0.3);
  const focusScore = clamp((largestBlobCenterRatio - 0.25) / 0.35);
  const secondaryScore = clamp(((largestBlob + secondLargestBlob) - 0.35) / 0.45);
  const variancePenalty = clamp(1 - toneVariance * 1.8);

  let combined =
    skinScore * 0.28 +
    blobScore * 0.26 +
    centerScore * 0.2 +
    boxScore * 0.14 +
    focusScore * 0.12;
  combined = Math.max(combined, blobScore * 0.55 + centerScore * 0.45);
  combined = Math.max(combined, centerScore * 0.5 + boxScore * 0.5);
  combined = Math.max(combined, secondaryScore * 0.75);
  combined *= variancePenalty;
  return clamp(combined);
}


export async function evaluateImage(buffer, filename, designName = '', options = {}) {
  const debug = { metadata: null, skin: null, illustration: null, nazi: null, textHints: 0, scores: {} };
  let workingBuffer = buffer;

  try {
    const prepared = await prepareModerationImage(buffer);
    workingBuffer = prepared.buffer;
    debug.metadata = {
      original: prepared.originalMeta,
      normalized: prepared.meta,
      removedAlpha: prepared.removedAlpha,
      padding: prepared.padding,
      error: prepared.error,
    };
  } catch (err) {
    debug.metadata = { error: err?.message || err };
  }

  const blockReasons = new Set();
  const reviewReasons = new Set();
  let decisionConfidence = 0.5;

  const metaGate = hateTextCheck({ filename, designName, textHints: '' });
  const textSignals = [];
  if (metaGate.blocked) {
    textSignals.push({ source: 'metadata', value: 0.75, reason: 'extremism_nazi_text', term: metaGate.term });
  }

  const nazi = await detectNazi(workingBuffer);
  debug.nazi = nazi;

  const illustration = await detectIllustration(workingBuffer);
  debug.illustration = illustration;

  const skin = await detectSkin(workingBuffer);
  debug.skin = skin;

  let textHints = '';
  if (!SKIP_OCR) {
    textHints = await extractTextHints(workingBuffer);
  }
  debug.textHints = textHints.length;
  if (textHints) {
    const ocrGate = hateTextCheck({ filename, designName, textHints });
    if (ocrGate.blocked) {
      textSignals.push({ source: 'ocr', value: 0.8, reason: 'extremism_nazi_text', term: ocrGate.term });
    }
  }

  const textSignal = textSignals.reduce((max, s) => Math.max(max, s.value), 0);
  debug.scores.nazi_text_signal = textSignal;

  const shapeSignal = nazi?.shapeSignal ?? 0;
  const paletteSignal = nazi?.paletteSignal ?? 0;
  debug.scores.nazi_shape = shapeSignal;
  debug.scores.nazi_palette = paletteSignal;

  const positiveSignals = [];
  if (shapeSignal >= NAZI_BLOCK_THRESHOLD) positiveSignals.push(shapeSignal);
  if (paletteSignal >= NAZI_BLOCK_THRESHOLD) positiveSignals.push(paletteSignal);
  if (textSignal >= NAZI_BLOCK_THRESHOLD) positiveSignals.push(textSignal);

  let naziScore = 0;
  if (positiveSignals.length >= 2 && !(nazi?.likelyManji && paletteSignal < NAZI_BLOCK_THRESHOLD)) {
    positiveSignals.sort((a, b) => b - a);
    naziScore = (positiveSignals[0] + positiveSignals[1]) / 2;
  }
  debug.scores.nazi_score = naziScore;

  if (naziScore >= NAZI_BLOCK_THRESHOLD) {
    blockReasons.add('extremism_nazi');
    if (textSignal >= NAZI_BLOCK_THRESHOLD) {
      blockReasons.add('extremism_nazi_text');
    }
    decisionConfidence = Math.max(decisionConfidence, clamp(0.72 + naziScore * 0.25));
  } else if (textSignal >= NAZI_BLOCK_THRESHOLD) {
    reviewReasons.add('extremism_nazi_text');
  }

  const cartoonConfidence = illustration?.cartoonConfidence ?? 0;
  const realProbability = clamp(1 - cartoonConfidence * 0.7 + 0.1);
  const skinPercent = skin?.skinPercent ?? 0;
  const centerSkinPercent = skin?.centerSkinPercent ?? 0;
  const largestBlob = skin?.largestBlob ?? 0;
  const largestBlobCenterRatio = skin?.largestBlobCenterRatio ?? 0;
  const largestBlobBoxCoverage = skin?.largestBlobBoxCoverage ?? 0;

  const personScore = clamp(
    Math.max(
      largestBlob * 0.6 + centerSkinPercent * 0.4,
      largestBlobCenterRatio,
      skinPercent * 0.5
    )
  );

  const isRealPerson = personScore >= PERSON_SCORE_THRESHOLD && realProbability >= REAL_PERSON_THRESHOLD;

  debug.scores.person_score = personScore;
  debug.scores.is_real_prob = realProbability;
  debug.scores.is_real_person = isRealPerson ? 1 : 0;
  debug.scores.skinPercent = skinPercent;
  debug.scores.centerSkinPercent = centerSkinPercent;
  debug.scores.largestBlob = largestBlob;
  debug.scores.largestBlobCenterRatio = largestBlobCenterRatio;
  debug.scores.cartoonConfidence = cartoonConfidence;

  const allowByPersonGate = !isRealPerson;

  // Server-side pipeline currently lacks a minor classifier; default to zero risk until integrated.
  let minorProbability = 0;
  debug.scores.minor_prob = minorProbability;

  if (!allowByPersonGate) {
    if (minorProbability >= MINOR_BLOCK_THRESHOLD) {
      blockReasons.add('minor');
      decisionConfidence = Math.max(decisionConfidence, clamp(0.82 + (minorProbability - MINOR_BLOCK_THRESHOLD) * 0.3));
    } else if (minorProbability >= MINOR_REVIEW_THRESHOLD) {
      reviewReasons.add('minor_review');
    }
  }

  const nudityConfidence = computeNudityConfidence(skin);
  const visibleAreaRatio = clamp(largestBlobBoxCoverage || largestBlob || 0);
  const isFemaleProb = clamp(personScore);
  const faceOrTorsoPresent = clamp(personScore);
  const buttExposedScore = 0; // Placeholder until dedicated detector is available server-side.
  const detectionConfidence = clamp(personScore);
  const detectionConfidenceOk = detectionConfidence >= IGNORE_DETECTION_CONFIDENCE_BELOW;

  const genitalsScore = clamp((nudityConfidence - 0.5) / 0.3);
  const areolaScore = clamp((centerSkinPercent - 0.55) / 0.25);
  const sexActScore = clamp((nudityConfidence - 0.6) / 0.25);

  debug.scores.realNudity = nudityConfidence;
  debug.scores.visible_area_ratio = visibleAreaRatio;
  debug.scores.genitals_score = genitalsScore;
  debug.scores.areola_score = areolaScore;
  debug.scores.sex_act_score = sexActScore;
  debug.scores.butt_exposed_score = buttExposedScore;
  debug.scores.face_or_torso_present = faceOrTorsoPresent;
  debug.scores.detection_confidence = detectionConfidence;

  if (!allowByPersonGate && detectionConfidenceOk && !blockReasons.has('extremism_nazi')) {
    if (genitalsScore >= GENITALS_THRESHOLD && visibleAreaRatio >= VISIBLE_AREA_RATIO_MIN) {
      blockReasons.add('real_nudity');
      decisionConfidence = Math.max(decisionConfidence, clamp(0.7 + (genitalsScore - GENITALS_THRESHOLD) * 0.25));
    } else if (areolaScore >= AREOLA_THRESHOLD && isFemaleProb >= 0.6) {
      blockReasons.add('real_nudity');
      decisionConfidence = Math.max(decisionConfidence, clamp(0.68 + (areolaScore - AREOLA_THRESHOLD) * 0.25));
    } else if (sexActScore >= SEX_ACT_THRESHOLD) {
      blockReasons.add('real_nudity');
      decisionConfidence = Math.max(decisionConfidence, clamp(0.7 + (sexActScore - SEX_ACT_THRESHOLD) * 0.3));
    } else if (buttExposedScore >= BUTT_EXPOSED_THRESHOLD && faceOrTorsoPresent >= 0.5) {
      blockReasons.add('real_nudity');
      decisionConfidence = Math.max(decisionConfidence, clamp(0.7 + (buttExposedScore - BUTT_EXPOSED_THRESHOLD) * 0.25));
    } else {
      if (
        genitalsScore >= GENITALS_THRESHOLD - REVIEW_MARGIN &&
        genitalsScore < GENITALS_THRESHOLD &&
        visibleAreaRatio >= VISIBLE_AREA_RATIO_MIN
      ) {
        reviewReasons.add('real_nudity_review');
      }
      if (
        areolaScore >= AREOLA_THRESHOLD - REVIEW_MARGIN &&
        areolaScore < AREOLA_THRESHOLD &&
        isFemaleProb >= 0.6
      ) {
        reviewReasons.add('real_nudity_review');
      }
      if (
        sexActScore >= SEX_ACT_THRESHOLD - REVIEW_MARGIN &&
        sexActScore < SEX_ACT_THRESHOLD
      ) {
        reviewReasons.add('real_nudity_review');
      }
      if (
        buttExposedScore >= BUTT_EXPOSED_THRESHOLD - REVIEW_MARGIN &&
        buttExposedScore < BUTT_EXPOSED_THRESHOLD &&
        faceOrTorsoPresent >= 0.5
      ) {
        reviewReasons.add('real_nudity_review');
      }
    }
  } else if (!allowByPersonGate && !detectionConfidenceOk) {
    debug.scores.explicit_skipped_low_confidence = 1;
  }

  if (blockReasons.has('extremism_nazi')) {
    debug.decision = 'BLOCK';
    return {
      label: 'BLOCK',
      reasons: Array.from(blockReasons),
      confidence: decisionConfidence,
      details: debug,
    };
  }

  if (blockReasons.has('minor')) {
    debug.decision = 'BLOCK';
    return {
      label: 'BLOCK',
      reasons: Array.from(blockReasons),
      confidence: decisionConfidence,
      details: debug,
    };
  }

  if (blockReasons.has('real_nudity')) {
    debug.decision = 'BLOCK';
    return {
      label: 'BLOCK',
      reasons: Array.from(blockReasons),
      confidence: decisionConfidence,
      details: debug,
    };
  }

  if (reviewReasons.size) {
    debug.decision = 'REVIEW';
    return {
      label: 'REVIEW',
      reasons: Array.from(reviewReasons),
      confidence: clamp(0.45 + (Math.max(genitalsScore, areolaScore, sexActScore, buttExposedScore) || 0) * 0.1),
      details: debug,
    };
  }

  debug.decision = 'ALLOW';
  return {
    label: 'ALLOW',
    reasons: ['no_violation_detected'],
    confidence: clamp(0.78 + Math.max(0, realProbability - 0.5) * 0.1),
    details: debug,
  };
}

export default async function moderateImage(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    if (typeof res.status === 'function') {
      res.status(204);
    } else {
      res.statusCode = 204;
    }
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(req, res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  try {
    const raw = await readBody(req);
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      sendJson(req, res, 400, { ok: false, reason: 'invalid_body' });
      return;
    }

    const isPreview = req?.query?.preview === '1' || req?.headers?.['x-preview'] === '1';

    let buffer = null;
    let previewBytes = null;
    const filename = data?.filename || '';
    const designName = data?.designName || '';
    const rid = typeof data?.rid === 'string' && data.rid.trim().length ? data.rid.trim() : null;
    if (data?.dataUrl) {
      buffer = toBufferFromDataUrl(data.dataUrl);
      if (buffer && isPreview) {
        previewBytes = buffer.length;
      }
    }
    if (!buffer && data?.imageBase64) {
      if (isPreview) {
        previewBytes = Buffer.byteLength(data.imageBase64, 'base64');
      }
      buffer = Buffer.from(data.imageBase64, 'base64');
    }
    if (!buffer) {
      sendJson(req, res, 400, { ok: false, reason: 'invalid_body' });
      return;
    }

    if (isPreview) {
      const size = previewBytes ?? buffer.length;
      if (Number.isFinite(size) && size > MOD_PREVIEW_LIMIT_BYTES) {
        sendJson(req, res, 413, {
          ok: false,
          error: 'preview_too_large',
          limitBytes: MOD_PREVIEW_LIMIT_BYTES,
          receivedBytes: size,
          preview: true,
          diagId: rid || null,
        });
        return;
      }
      // El original se sigue subiendo por /api/upload-original sin recomprimir.
    }

    const result = await evaluateImage(buffer, filename, designName);
    if (result.label === 'BLOCK') {
      sendJson(req, res, 400, {
        ok: false,
        reason: result.reasons?.[0] || 'blocked',
        ...result,
      });
      return;
    }

    sendJson(req, res, 200, { ok: true, ...result });
  } catch (e) {
    logger.error(e);
    sendJson(req, res, 500, {
      ok: false,
      reason: 'server_error',
      error: String(e?.message || e),
    });
  }
}