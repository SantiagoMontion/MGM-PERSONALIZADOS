import sharp from 'sharp';
import { pHashFromGray, hamming } from '../hashing.js';
import { hateTextCheck } from '../moderation/hate.js';

const SKIP_OCR = process.env.MODERATION_SKIP_OCR === '1';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

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
  const svgs = [];
  const rotations = [0, 45, 90, 135];
  const strokes = [8, 10, 12];
  for (const r of rotations) for (const st of strokes) svgs.push(swastikaSVG({ rotate: r, stroke: st, invert: false, flag: false }));
  // flags variants
  for (const r of [0]) for (const st of [10]) svgs.push(swastikaSVG({ rotate: r, stroke: st, invert: false, flag: true }));
  const hashes = [];
  for (const svg of svgs) {
    const buf = Buffer.from(svg);
    const { data, info } = await sharp(buf).resize(64, 64).grayscale().raw().toBuffer({ resolveWithObject: true });
    const hash = pHashFromGray(data, info.width, info.height);
    hashes.push(hash);
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
  for (const th of tmpls) {
    const d = hamming(hash, th);
    if (d < minDist) minDist = d;
    if (d <= 12) return { nazi: true, reason: 'phash', score: d };
  }
  const { data: d2, info: i2 } = await sharp(buffer).removeAlpha().resize({ width: 128 }).raw().toBuffer({ resolveWithObject: true });
  const w = i2.width, h = i2.height, total = w * h;
  let redDom = 0, whiteInCircle = 0, blackStroke = 0, inCircleCount = 0, inRingCount = 0;
  const redMask = new Uint8Array(total);
  const whiteMask = new Uint8Array(total);
  const blackMask = new Uint8Array(total);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const r = Math.floor(Math.min(w, h) * 0.3);
  for (let p = 0, idx = 0; p < total; p++, idx += i2.channels) {
    const R = d2[idx], G = d2[idx + 1], B = d2[idx + 2];
    const isRed = R > 200 && G < 90 && B < 90;
    const isWhite = R > 220 && G > 220 && B > 220;
    const isBlack = R < 55 && G < 55 && B < 55;
    if (isRed) {
      redDom++;
      redMask[p] = 1;
    }
    if (isWhite) {
      whiteInCircle++;
      whiteMask[p] = 1;
    }
    if (isBlack) {
      blackStroke++;
      blackMask[p] = 1;
    }
    const x = p % w, y = Math.floor(p / w);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= r) inCircleCount++;
    if (dist > r * 0.85 && dist < r * 1.1) inRingCount++;
  }
  const redRatio = redDom / total;
  const whiteCircleRatio = inCircleCount ? whiteInCircle / inCircleCount : 0;
  const blackStrokeRatio = inRingCount ? blackStroke / inRingCount : 0;
  const COLOR_MATCH_THRESHOLDS = {
    red: 0.5,
    white: 0.75,
    black: 0.18,
    minDist: 24,
  };
  if (
    minDist <= COLOR_MATCH_THRESHOLDS.minDist &&
    redRatio >= COLOR_MATCH_THRESHOLDS.red &&
    whiteCircleRatio >= COLOR_MATCH_THRESHOLDS.white &&
    blackStrokeRatio >= COLOR_MATCH_THRESHOLDS.black
  ) {
    return {
      nazi: true,
      reason: 'flag_heuristic',
      score: { redRatio, whiteCircleRatio, blackStrokeRatio, minDist },
    };
  }
  return { nazi: false, reason: 'none', score: minDist };
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
  let blockConfidence = 0;

  const markBlocked = (reason, confidence = 0.6) => {
    if (!reason) return;
    blockReasons.add(reason);
    blockConfidence = Math.max(blockConfidence, clamp(confidence));
  };

  const metaGate = hateTextCheck({ filename, designName, textHints: '' });
  if (metaGate.blocked) {
    markBlocked('extremism_nazi_text', 0.85);
  }

  const illustration = await detectIllustration(workingBuffer);
  debug.illustration = illustration;

  const skin = await detectSkin(workingBuffer);
  debug.skin = skin;

  const nudityConfidence = computeNudityConfidence(skin);
  debug.scores.realNudity = nudityConfidence;

  const skinPercent = skin?.skinPercent ?? 0;
  const centerSkinPercent = skin?.centerSkinPercent ?? 0;
  const largestBlob = skin?.largestBlob ?? 0;
  const largestBlobBoxCoverage = skin?.largestBlobBoxCoverage ?? 0;
  const largestBlobCenterRatio = skin?.largestBlobCenterRatio ?? 0;
  const toneVariance = skin?.toneVariance ?? 0;
  const paletteRatio = illustration?.paletteRatio ?? 0;
  const edgeRatio = illustration?.edgeRatio ?? 0;
  const cartoonConfidence = illustration?.cartoonConfidence ?? 0;

  debug.scores.skinPercent = skinPercent;
  debug.scores.centerSkinPercent = centerSkinPercent;
  debug.scores.largestBlob = largestBlob;
  debug.scores.paletteRatio = paletteRatio;
  debug.scores.edgeRatio = edgeRatio;
  debug.scores.cartoonConfidence = cartoonConfidence;

  const meetsCoverage = (
    skinPercent >= 0.35 &&
    centerSkinPercent >= 0.28 &&
    largestBlob >= 0.24
  );

  const strongCenter = centerSkinPercent >= 0.55;
  const strongBlob = largestBlob >= 0.42 || largestBlobBoxCoverage >= 0.38;
  const highSkinCoverage = skinPercent >= 0.5;
  const notCartoon =
    cartoonConfidence < 0.65 ||
    paletteRatio >= 0.015 ||
    edgeRatio <= 0.03 ||
    toneVariance <= 0.18;

  debug.scores.notCartoon = notCartoon ? 1 : 0;

  const shouldBlockStrong = strongCenter && strongBlob && highSkinCoverage && notCartoon;
  const shouldBlockByConfidence =
    !shouldBlockStrong &&
    nudityConfidence >= 0.72 &&
    meetsCoverage &&
    notCartoon &&
    centerSkinPercent >= 0.4 &&
    largestBlob >= 0.35;

  if (shouldBlockStrong || shouldBlockByConfidence) {
    const baseConfidence = shouldBlockStrong ? 0.78 : 0.7;
    const confidence = clamp(baseConfidence + (nudityConfidence - 0.7) * 0.5);
    markBlocked('real_nudity', confidence);
  }

  const nazi = await detectNazi(workingBuffer);
  debug.nazi = nazi;
  if (nazi?.nazi) {
    if (nazi.reason === 'phash') {
      const score = typeof nazi.score === 'number' ? nazi.score : 0;
      const conf = clamp(0.95 - score * 0.03, 0.6, 0.95);
      markBlocked('extremism_nazi', conf);
    } else {
      markBlocked('extremism_nazi', 0.85);
    }
  }

  if (!blockReasons.size && !metaGate.blocked) {
    const textHints = await extractTextHints(workingBuffer);
    debug.textHints = textHints.length;
    if (textHints) {
      const ocrGate = hateTextCheck({ filename, designName, textHints });
      if (ocrGate.blocked) {
        markBlocked('extremism_nazi_text', 0.82);
      }
    }
  }

  if (blockReasons.size) {
    return {
      label: 'BLOCK',
      reasons: Array.from(blockReasons),
      confidence: blockConfidence || 0.65,
      details: debug,
    };
  }

  return {
    label: 'ALLOW',
    reasons: ['no_violation_detected'],
    confidence: clamp(0.78 + Math.max(0, 0.5 - cartoonConfidence) * 0.08),
    details: debug,
  };
}

export default async function moderateImage(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    if (req.method !== 'POST') return res.status(405).end();

    const raw = await readBody(req);
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return res.status(400).json({ ok: false, reason: 'invalid_body' });
    }

    let buffer = null;
    const filename = data?.filename || '';
    const designName = data?.designName || '';
    if (data?.dataUrl) buffer = toBufferFromDataUrl(data.dataUrl);
    if (!buffer && data?.imageBase64) buffer = Buffer.from(data.imageBase64, 'base64');
    if (!buffer) return res.status(400).json({ ok: false, reason: 'invalid_body' });

    const result = await evaluateImage(buffer, filename, designName);
    if (result.label === 'BLOCK') {
      return res.status(400).json({
        ok: false,
        reason: result.reasons?.[0] || 'blocked',
        ...result,
      });
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, reason: 'server_error', error: String(e) });
  }
}