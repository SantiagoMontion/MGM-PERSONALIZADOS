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
    const isSkin = Cb >= 85 && Cb <= 125 && Cr >= 135 && Cr <= 170 && Y >= 80 && Y <= 200;
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
  const diffThreshold = 120;

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
  const paletteScore = clamp((0.6 - paletteRatio) / 0.5);
  const edgeScore = clamp((edgeRatio - 0.1) / 0.3);
  const cartoonConfidence = clamp(paletteScore * 0.5 + edgeScore * 0.5);

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
  // Swastika templates
  for (const r of rotations) for (const st of strokes) svgs.push(swastikaSVG({ rotate: r, stroke: st, invert: false, flag: false }));
  for (const r of [0]) for (const st of [10]) svgs.push(swastikaSVG({ rotate: r, stroke: st, invert: false, flag: true }));
  // Improved Hitler face templates (simulated with varied shapes)
  const hitlerSvgs = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="#ddd"/><rect x="20" y="15" width="24" height="24" fill="#999"/><rect x="28" y="35" width="8" height="4" fill="#555"/></svg>`, // Face with mustache
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="#ddd"/><rect x="18" y="12" width="28" height="28" fill="#999"/><rect x="26" y="32" width="12" height="6" fill="#555"/></svg>`, // Larger face variation
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="#ddd"/><rect x="22" y="10" width="20" height="20" fill="#999"/><rect x="30" y="28" width="4" height="4" fill="#000"/></svg>`, // Minimal face
  ];
  svgs.push(...hitlerSvgs);
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
  let minDistType = 'none';
  // Swastika detection
  for (let i = 0; i < tmpls.length - 3; i++) { // First templates are swastikas
    const d = hamming(hash, tmpls[i]);
    if (d < minDist) {
      minDist = d;
      minDistType = 'swastika';
      if (d <= 20) return { nazi: true, reason: 'phash_swastika', score: d };
    }
  }
  // Hitler face detection (last 3 templates)
  const hitlerStartIdx = tmpls.length - 3;
  for (let i = hitlerStartIdx; i < tmpls.length; i++) {
    const d = hamming(hash, tmpls[i]);
    if (d < minDist) {
      minDist = d;
      minDistType = 'hitler';
      if (d <= 30) return { nazi: true, reason: 'phash_hitler', score: d }; // Increased from 25
    }
  }
  // Raised hand gesture detection
  const { data: edgeData, info: edgeInfo } = await image
    .resize(128, 128)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = edgeInfo.width, h = edgeInfo.height;
  let verticalEdges = 0, totalComparisons = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const idx = (y * w + x);
      const diff = Math.abs(edgeData[idx] - edgeData[idx + 1]);
      if (diff > 80) verticalEdges++; // Lowered from 100
      totalComparisons++;
    }
  }
  const edgeRatio = totalComparisons ? verticalEdges / totalComparisons : 0;
  if (edgeRatio > 0.1 && minDist <= 35) { // Lowered from 0.15 and increased minDist
    return { nazi: true, reason: 'gesture_heuristic', score: edgeRatio };
  }
  // Flag detection
  const { data: d2, info: i2 } = await sharp(buffer).removeAlpha().resize({ width: 128 }).raw().toBuffer({ resolveWithObject: true });
  const total = w * h;
  let redDom = 0, whiteInCircle = 0, blackStroke = 0, inCircleCount = 0, inRingCount = 0;
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const r = Math.floor(Math.min(w, h) * 0.3);
  for (let p = 0, idx = 0; p < total; p++, idx += i2.channels) {
    const R = d2[idx], G = d2[idx + 1], B = d2[idx + 2];
    const isRed = R > 200 && G < 90 && B < 90;
    const isWhite = R > 220 && G > 220 && B > 220;
    const isBlack = R < 55 && G < 55 && B < 55;
    if (isRed) redDom++;
    if (isWhite) whiteInCircle++;
    if (isBlack) blackStroke++;
    const x = p % w, y = Math.floor(p / w);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= r) inCircleCount++;
    if (dist > r * 0.85 && dist < r * 1.1) inRingCount++;
  }
  const redRatio = redDom / total;
  const whiteCircleRatio = inCircleCount ? whiteInCircle / inCircleCount : 0;
  const blackStrokeRatio = inRingCount ? blackStroke / inRingCount : 0;
  const COLOR_MATCH_THRESHOLDS = {
    red: 0.3, // Lowered from 0.4
    white: 0.5, // Lowered from 0.6
    black: 0.1, // Lowered from 0.15
    minDist: 35, // Increased from 30
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

const MIN_PADDED_DIMENSION = 512;
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
  centerSkinPercent = 0,
  largestBlobBoxCoverage = 0,
  largestBlobCenterRatio = 0,
  toneVariance = 0,
} = {}) {
  const skinScore = clamp((skinPercent - 0.4) / 0.3);
  const blobScore = clamp((largestBlob - 0.2) / 0.3);
  const centerScore = clamp((centerSkinPercent - 0.3) / 0.3);
  const boxScore = clamp((largestBlobBoxCoverage - 0.3) / 0.3);
  const focusScore = clamp((largestBlobCenterRatio - 0.3) / 0.4);
  const variancePenalty = clamp(1 - toneVariance * 1.5);

  let combined =
    skinScore * 0.3 +
    blobScore * 0.3 +
    centerScore * 0.25 +
    boxScore * 0.15 +
    focusScore * 0.1;
  combined = Math.max(combined, blobScore * 0.6 + centerScore * 0.4);
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
    debug.metadata = { error: err?.message };
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
  const cartoonConfidence = illustration?.cartoonConfidence ?? 0;

  debug.scores.skinPercent = skinPercent;
  debug.scores.centerSkinPercent = centerSkinPercent;
  debug.scores.largestBlob = largestBlob;
  debug.scores.cartoonConfidence = cartoonConfidence;

  const meetsCoverage = (
    skinPercent >= 0.3 &&
    centerSkinPercent >= 0.2 &&
    largestBlob >= 0.2
  );

  const strongCenter = centerSkinPercent >= 0.4;
  const strongBlob = largestBlob >= 0.3;
  const highSkinCoverage = skinPercent >= 0.35;
  const notCartoon = cartoonConfidence < 0.6;

  debug.scores.notCartoon = notCartoon ? 1 : 0;

  // Check Nazi content first
  const nazi = await detectNazi(workingBuffer);
  debug.nazi = nazi;
  if (nazi?.nazi) {
    const confidence = nazi.reason === 'phash_swastika' ? clamp(0.95 - nazi.score * 0.03, 0.6, 0.95) :
                        nazi.reason === 'phash_hitler' ? clamp(0.90 - nazi.score * 0.03, 0.6, 0.90) :
                        nazi.reason === 'gesture_heuristic' ? clamp(0.85 + (nazi.score - 0.1) * 2, 0.85, 0.95) :
                        0.85;
    markBlocked('extremism_nazi', confidence);
  }

  // Only check nudity if no Nazi content is detected, or if nudity confidence is significantly higher
  if (!blockReasons.size && !metaGate.blocked) {
    const shouldBlockStrong = strongCenter && strongBlob && highSkinCoverage && notCartoon;
    const shouldBlockByConfidence =
      !shouldBlockStrong &&
      nudityConfidence >= 0.55 && // Increased from 0.5 to reduce false positives
      meetsCoverage &&
      notCartoon &&
      centerSkinPercent >= 0.25 &&
      largestBlob >= 0.25;

    // Add landscape filter: Skip nudity if cartoonConfidence is low and skin is diffuse
    const isLikelyLandscape = cartoonConfidence >= 0.4 && largestBlobCenterRatio < 0.3;
    if ((shouldBlockStrong || shouldBlockByConfidence) && !isLikelyLandscape) {
      const baseConfidence = shouldBlockStrong ? 0.78 : 0.7;
      const confidence = clamp(baseConfidence + (nudityConfidence - 0.55) * 0.5);
      if (confidence > 0.85 || !nazi.nazi) {
        markBlocked('real_nudity', confidence);
      }
    }

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
    confidence: clamp(0.8 + Math.max(0, 0.5 - cartoonConfidence) * 0.1),
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
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}