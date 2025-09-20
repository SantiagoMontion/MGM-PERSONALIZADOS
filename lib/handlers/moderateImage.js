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
    try { console.warn('[moderation] OCR failed', err?.message || err); } catch {}
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
  // pHash
  const { data, info } = await image.resize(64, 64).grayscale().raw().toBuffer({ resolveWithObject: true });
  const hash = pHashFromGray(data, info.width, info.height);
  const tmpls = await getTemplates();
  let minDist = Infinity;
  for (const th of tmpls) {
    const d = hamming(hash, th);
    if (d < minDist) minDist = d;
    if (d <= 12) return { nazi: true, reason: 'phash', score: d };
  }
  // Color/shape heuristic for flag
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
    if (isWhite) whiteMask[p] = 1;
    if (isBlack) blackMask[p] = 1;
    const x = p % w, y = Math.floor(p / w);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= r) {
      inCircleCount++;
      if (isWhite) whiteInCircle++;
    }
    if (dist > r * 0.85 && dist < r * 1.1) {
      inRingCount++;
      if (isBlack) blackStroke++;
    }
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

  const stride = w + 1;
  const buildIntegral = (mask) => {
    const integral = new Uint32Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y++) {
      let rowSum = 0;
      for (let x = 1; x <= w; x++) {
        const idx = (y - 1) * w + (x - 1);
        rowSum += mask[idx];
        integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + rowSum;
      }
    }
    return integral;
  };

  const rectSum = (integral, x0, y0, x1, y1) => {
    const clampedX0 = Math.max(0, Math.min(w, x0));
    const clampedY0 = Math.max(0, Math.min(h, y0));
    const clampedX1 = Math.max(0, Math.min(w, x1));
    const clampedY1 = Math.max(0, Math.min(h, y1));
    if (clampedX1 <= clampedX0 || clampedY1 <= clampedY0) return 0;
    return (
      integral[clampedY1 * stride + clampedX1] -
      integral[clampedY0 * stride + clampedX1] -
      integral[clampedY1 * stride + clampedX0] +
      integral[clampedY0 * stride + clampedX0]
    );
  };

  const integralRed = buildIntegral(redMask);
  const integralWhite = buildIntegral(whiteMask);
  const integralBlack = buildIntegral(blackMask);
  const minWindow = Math.max(18, Math.floor(Math.min(w, h) * 0.18));
  const maxWindow = Math.max(minWindow, Math.floor(Math.min(w, h) * 0.6));

  for (let size = minWindow; size <= maxWindow; size += Math.max(6, Math.floor(size * 0.35))) {
    const step = Math.max(4, Math.floor(size * 0.25));
    for (let y = 0; y <= h - size; y += step) {
      for (let x = 0; x <= w - size; x += step) {
        const area = size * size;
        const redCountLocal = rectSum(integralRed, x, y, x + size, y + size);
        const redRatioLocal = redCountLocal / area;
        if (redRatioLocal < 0.32) continue;
        const innerSize = Math.max(8, Math.floor(size * 0.52));
        const innerX = x + Math.floor((size - innerSize) / 2);
        const innerY = y + Math.floor((size - innerSize) / 2);
        const innerArea = innerSize * innerSize;
        const whiteInner = rectSum(integralWhite, innerX, innerY, innerX + innerSize, innerY + innerSize);
        const blackInner = rectSum(integralBlack, innerX, innerY, innerX + innerSize, innerY + innerSize);
        const whiteInnerRatio = whiteInner / innerArea;
        const blackInnerRatio = blackInner / innerArea;
        if (whiteInnerRatio < 0.4 || blackInnerRatio < 0.1 || blackInnerRatio > 0.45) continue;
        const half = Math.floor(innerSize / 2);
        const leftBlack = rectSum(integralBlack, innerX, innerY, innerX + half, innerY + innerSize);
        const rightBlack = rectSum(integralBlack, innerX + half, innerY, innerX + innerSize, innerY + innerSize);
        const topBlack = rectSum(integralBlack, innerX, innerY, innerX + innerSize, innerY + half);
        const bottomBlack = rectSum(integralBlack, innerX, innerY + half, innerX + innerSize, innerY + innerSize);
        if (!leftBlack || !rightBlack || !topBlack || !bottomBlack) continue;
        const centerBand = Math.max(3, Math.floor(innerSize * 0.18));
        const centerX0 = innerX + Math.floor((innerSize - centerBand) / 2);
        const centerY0 = innerY + Math.floor((innerSize - centerBand) / 2);
        const centerVertical = rectSum(
          integralBlack,
          centerX0,
          innerY,
          centerX0 + centerBand,
          innerY + innerSize
        );
        const centerHorizontal = rectSum(
          integralBlack,
          innerX,
          centerY0,
          innerX + innerSize,
          centerY0 + centerBand
        );
        const verticalDensity = centerVertical / (centerBand * innerSize);
        const horizontalDensity = centerHorizontal / (centerBand * innerSize);
        if (verticalDensity < 0.05 || horizontalDensity < 0.05) continue;
        return {
          nazi: true,
          reason: 'flag_patch',
          score: {
            patchSize: size,
            innerSize,
            redRatioLocal,
            whiteInnerRatio,
            blackInnerRatio,
            verticalDensity,
            horizontalDensity,
            minDist,
          },
        };
      }
    }
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
    try {
      console.warn('[moderation] prepareModerationImage failed', err?.message || err);
    } catch {}
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

const SEVERITY_RANK = { ALLOW: 0, REVIEW: 1, BLOCK: 2 };

export async function evaluateImage(buffer, filename, designName = '', options = {}) {
  const lowQualityAck = Boolean(options?.lowQualityAck);
  const approxDpiRaw = Number(options?.approxDpi);
  const approxDpi = Number.isFinite(approxDpiRaw) ? approxDpiRaw : null;
  const debug = { metadata: null, skin: null, illustration: null, nazi: null, textHints: 0, scores: {}, flags: { lowQualityAck, approxDpi } };
  let label = 'ALLOW';
  let reasons = [];
  let blockConfidence = 0;
  let reviewConfidence = 0;

  const applyOutcome = (newLabel, newReasons = [], newConfidence = 0) => {
    const currentRank = SEVERITY_RANK[label];
    const newRank = SEVERITY_RANK[newLabel];
    if (newRank === undefined) return;

    if (newRank === SEVERITY_RANK.BLOCK) blockConfidence = Math.max(blockConfidence, newConfidence);
    if (newRank === SEVERITY_RANK.REVIEW) reviewConfidence = Math.max(reviewConfidence, newConfidence);

    const filteredReasons = newReasons.filter(Boolean);
    if (newRank > currentRank) {
      label = newLabel;
      reasons = filteredReasons.length ? [...filteredReasons] : [];
    } else if (newRank === currentRank && filteredReasons.length) {
      for (const reason of filteredReasons) {
        if (!reasons.includes(reason)) reasons.push(reason);
      }
    }
  };

  // Preload metadata for downstream heuristics and normalize buffer
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

  const metaGate = hateTextCheck({ filename, designName, textHints: '' });
  debug.scores.metaText = metaGate.blocked ? 0.85 : 0;
  if (metaGate.blocked) {
    applyOutcome('BLOCK', ['extremism_nazi_text'], 0.85);
  }

  // Pre-compute illustration confidence before applying nudity heuristics so we can relax
  // false positives on stylized or padded images (e.g. Valorant renders or solid color fills).
  const illustration = await detectIllustration(workingBuffer);
  debug.illustration = illustration;
  const cartoonConfidence = illustration?.cartoonConfidence || 0;
  debug.scores.illustration = cartoonConfidence;

  // A) skin-based real nudity heuristic with illustration-based relaxations
  const skin = await detectSkin(workingBuffer);
  debug.skin = skin;
  let nudityConfidence = computeNudityConfidence(skin);

  const CARTOON_STRONG_THRESHOLD = 0.78;
  const CARTOON_RELAX_THRESHOLD = 0.6;
  const CARTOON_RELAX_MAX_PALETTE_RATIO = 0.018;
  const REAL_NUDITY_BLOCK_THRESHOLD = 0.55;
  const REAL_NUDITY_REVIEW_THRESHOLD = 0.45;
  const REAL_NUDITY_MIN_COVERAGE_FOR_REVIEW = 0.28;
  const REAL_NUDITY_MIN_BLOB_FOR_REVIEW = 0.16;
  const REAL_NUDITY_MIN_CENTER_FOR_REVIEW = 0.22;
  const REAL_NUDITY_MIN_COVERAGE_FOR_BLOCK = 0.35;
  const REAL_NUDITY_MIN_BLOB_FOR_BLOCK = 0.22;
  const REAL_NUDITY_MIN_CENTER_FOR_BLOCK = 0.28;

  const skinPercent = skin?.skinPercent ?? 0;
  const largestBlob = skin?.largestBlob ?? 0;
  const secondLargestBlob = skin?.secondLargestBlob ?? 0;
  const centerSkinPercent = skin?.centerSkinPercent ?? 0;
  const largestBlobBoxCoverage = skin?.largestBlobBoxCoverage ?? 0;
  const largestBlobCenterRatio = skin?.largestBlobCenterRatio ?? 0;
  const toneVariance = skin?.toneVariance ?? 0;
  const paletteRatio = illustration?.paletteRatio ?? 0;
  const edgeRatio = illustration?.edgeRatio ?? 0;
  const meetsReviewCoverage =
    skinPercent >= REAL_NUDITY_MIN_COVERAGE_FOR_REVIEW ||
    largestBlob >= REAL_NUDITY_MIN_BLOB_FOR_REVIEW ||
    centerSkinPercent >= REAL_NUDITY_MIN_CENTER_FOR_REVIEW;
  const meetsBlockCoverage =
    skinPercent >= REAL_NUDITY_MIN_COVERAGE_FOR_BLOCK ||
    largestBlob >= REAL_NUDITY_MIN_BLOB_FOR_BLOCK ||
    centerSkinPercent >= REAL_NUDITY_MIN_CENTER_FOR_BLOCK ||
    largestBlobBoxCoverage >= 0.28;

  const centerBoost = clamp((centerSkinPercent - 0.26) / 0.28);
  const blobBoost = clamp((largestBlob - 0.24) / 0.22);
  const boxBoost = clamp((largestBlobBoxCoverage - 0.3) / 0.26);
  const secondaryBoost = clamp(((largestBlob + secondLargestBlob) - 0.45) / 0.4);
  const combinedBoost = Math.max(centerBoost * 0.5 + blobBoost * 0.5, boxBoost, secondaryBoost);
  nudityConfidence = Math.max(nudityConfidence, combinedBoost);
  debug.scores.realNudity = nudityConfidence;

  const canRelaxForCartoon =
    cartoonConfidence >= CARTOON_RELAX_THRESHOLD &&
    paletteRatio <= CARTOON_RELAX_MAX_PALETTE_RATIO &&
    edgeRatio >= 0.028 &&
    toneVariance <= 0.12 &&
    centerSkinPercent <= 0.32 &&
    largestBlob <= 0.28 &&
    largestBlobCenterRatio <= 0.35;

  if (nudityConfidence >= REAL_NUDITY_BLOCK_THRESHOLD) {
    if (canRelaxForCartoon) {
      const allowConfidence = clamp(0.6 + (cartoonConfidence - CARTOON_RELAX_THRESHOLD) * 0.25);
      applyOutcome('ALLOW', ['animated_explicit_allowed'], allowConfidence);
    } else if (meetsBlockCoverage) {
      const nudityReasons = ['real_nudity'];
      if (largestBlob >= 0.38 || largestBlobBoxCoverage >= 0.38) nudityReasons.push('genitals_visible');
      if (skinPercent >= 0.7 || centerSkinPercent >= 0.4) nudityReasons.push('sex_act');
      if (centerSkinPercent >= 0.32) nudityReasons.push('high_center_skin');
      applyOutcome('BLOCK', nudityReasons, Math.max(nudityConfidence, centerBoost));
    } else if (meetsReviewCoverage) {
      applyOutcome('REVIEW', ['real_nudity_suspected'], nudityConfidence);
    }
  } else if (nudityConfidence >= REAL_NUDITY_REVIEW_THRESHOLD && meetsReviewCoverage) {
    if (canRelaxForCartoon && cartoonConfidence >= CARTOON_RELAX_THRESHOLD + 0.05) {
      const allowConfidence = clamp(0.58 + (cartoonConfidence - CARTOON_RELAX_THRESHOLD) * 0.22);
      applyOutcome('ALLOW', ['animated_skin_visible'], allowConfidence);
    } else {
      const reasons = centerSkinPercent >= 0.28 ? ['real_nudity_suspected', 'high_center_skin'] : ['real_nudity_suspected'];
      applyOutcome('REVIEW', reasons, nudityConfidence);
    }
  }

  // B) nazi detection via pHash + color heuristic
  const nazi = await detectNazi(workingBuffer);
  debug.nazi = nazi;
  let naziConfidence = 0;
  if (nazi.nazi) {
    if (nazi.reason === 'phash') {
      const dist = typeof nazi.score === 'number' ? nazi.score : 0;
      naziConfidence = clamp(0.95 - dist * 0.025, 0.6, 0.95);
    } else {
      naziConfidence = 0.85;
    }
    applyOutcome('BLOCK', ['extremism_nazi'], naziConfidence);
  }
  debug.scores.nazi = naziConfidence;

  // C) OCR-based hate speech detection (only if not already blocked for text)
  if (SEVERITY_RANK[label] < SEVERITY_RANK.BLOCK) {
    const textHints = await extractTextHints(workingBuffer);
    debug.textHints = textHints.length;
    if (textHints) {
      const textGate = hateTextCheck({ filename, designName, textHints });
      if (textGate.blocked) {
        applyOutcome('BLOCK', ['extremism_nazi_text'], 0.8);
      }
    }
  }

  // D) illustration vs real estimation based on skin detection context
  if (SEVERITY_RANK[label] < SEVERITY_RANK.BLOCK) {
    if (cartoonConfidence >= CARTOON_STRONG_THRESHOLD) {
      applyOutcome('ALLOW', ['animated_explicit_allowed'], cartoonConfidence);
    } else {
      const ANIMATED_REVIEW_MIN_CARTOON = 0.5;
      const ANIMATED_REVIEW_MIN_EDGE = 0.02;
      const ANIMATED_REVIEW_MIN_PALETTE = 24;
      const ANIMATED_REVIEW_MIN_SKIN = 0.2;
      const ANIMATED_REVIEW_MAX_SKIN = 0.9;
      const ANIMATED_REVIEW_MIN_BLOB = 0.12;
      const ANIMATED_REVIEW_MIN_PALETTE_RATIO = 0.003;
      const paletteRatio = illustration?.paletteRatio ?? 0;
      const qualifiesAnimatedReview =
        cartoonConfidence >= ANIMATED_REVIEW_MIN_CARTOON &&
        nudityConfidence >= 0.32 &&
        illustration?.edgeRatio >= ANIMATED_REVIEW_MIN_EDGE &&
        illustration?.paletteSize >= ANIMATED_REVIEW_MIN_PALETTE &&
        paletteRatio >= ANIMATED_REVIEW_MIN_PALETTE_RATIO &&
        skinPercent >= ANIMATED_REVIEW_MIN_SKIN &&
        skinPercent <= ANIMATED_REVIEW_MAX_SKIN &&
        largestBlob >= ANIMATED_REVIEW_MIN_BLOB;
      if (qualifiesAnimatedReview) {
        const allowConfidence = clamp(Math.max(cartoonConfidence, nudityConfidence));
        applyOutcome('ALLOW', ['animated_skin_visible'], allowConfidence);
      }
    }
  }

  // E) quality heuristics for review
  const originalMeta = debug.metadata?.original || null;
  const normalizedMeta = debug.metadata?.normalized || null;
  const meta = originalMeta || normalizedMeta || debug.metadata || {};
  const approxDpiValid = Number.isFinite(approxDpi);
  const approxDpiSufficient = approxDpiValid && approxDpi >= LOW_RES_MIN_APPROX_DPI;
  let lowResolutionOverrideRequested = false;
  if (SEVERITY_RANK[label] < SEVERITY_RANK.BLOCK) {
    const lowResolutionDimensions = Boolean(
      (meta.width && meta.width < LOW_RES_MIN_DIMENSION) ||
      (meta.height && meta.height < LOW_RES_MIN_DIMENSION)
    );
    const lowResolutionConcern = lowResolutionDimensions && !approxDpiSufficient;
    if (lowResolutionConcern) {
      debug.scores.lowResolution = 0.45;
      if (lowQualityAck) {
        debug.flags = { ...debug.flags, lowResolutionOverride: true };
        lowResolutionOverrideRequested = true;
        applyOutcome('ALLOW', ['low_resolution_acknowledged'], 0.55);
      } else {
        applyOutcome('REVIEW', ['low_resolution_uncertain'], 0.45);
      }
    } else if (lowResolutionDimensions) {
      debug.flags = {
        ...debug.flags,
        lowResolutionBypassed: {
          approxDpi: approxDpiValid ? approxDpi : null,
          width: meta.width || null,
          height: meta.height || null,
        },
      };
    }
  }

  if (lowResolutionOverrideRequested && label === 'REVIEW') {
    const seriousReviewReasons = new Set(['real_nudity_suspected']);
    const hasSeriousReview = reasons.some((reason) => seriousReviewReasons.has(reason));
    if (!hasSeriousReview) {
      label = 'ALLOW';
      reasons = ['low_resolution_acknowledged'];
      debug.flags = { ...debug.flags, lowResolutionOverrideApplied: true };
    }
  }

  let confidence = 0;
  if (label === 'BLOCK') {
    confidence = clamp(blockConfidence || 0.6);
  } else if (label === 'REVIEW') {
    confidence = clamp(reviewConfidence || 0.4);
  } else {
    if (!reasons.length) reasons.push('no_violation_detected');
    const base = 0.7;
    const boost = illustration.cartoonConfidence >= 0.7 ? (illustration.cartoonConfidence - 0.7) * 0.3 : 0;
    confidence = clamp(base + boost);
  }

  return { label, reasons, confidence, details: debug };
}

export default async function moderateImage(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      // CORS handled globally by router; just acknowledge
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
    const lowQualityAck = Boolean(data?.lowQualityAck);
    const approxDpiNum = Number(data?.approxDpi);
    const approxDpi = Number.isFinite(approxDpiNum) ? approxDpiNum : null;
    if (data?.dataUrl) buffer = toBufferFromDataUrl(data.dataUrl);
    if (!buffer && data?.imageBase64) buffer = Buffer.from(data.imageBase64, 'base64');
    if (!buffer) return res.status(400).json({ ok: false, reason: 'invalid_body' });

    const result = await evaluateImage(buffer, filename, designName, {
      lowQualityAck,
      approxDpi,
    });
    if (result.label === 'BLOCK') {
      return res.status(400).json({
        ok: false,
        reason: result.reasons?.[0] || 'blocked',
        ...result,
      });
    }
    if (result.label === 'REVIEW') {
      return res.status(400).json({
        ok: false,
        reason: 'review_required',
        ...result,
      });
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    try { console.error('moderate-image error', e); } catch {}
    return res.status(500).json({ ok: false });
  }
}

