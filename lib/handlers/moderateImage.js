import sharp from 'sharp';
import { pHashFromGray, hamming } from '../hashing.js';
import { hateTextCheck } from '../moderation/hate.js';

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
  for (let i = 0, p = 0; p < total; i += info.channels, p++) {
    const R = data[i], G = data[i+1], B = data[i+2];
    const Y  = 0.299*R + 0.587*G + 0.114*B;
    const Cb = 128 - 0.168736*R - 0.331264*G + 0.5*B;
    const Cr = 128 + 0.5*R - 0.418688*G - 0.081312*B;
    const isSkin = (Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173);
    if (isSkin) { mask[p] = 1; skinCount++; }
  }
  // largest connected component (4-neigh)
  const vis = new Uint8Array(total);
  let maxBlob = 0;
  const qx = new Int32Array(total);
  const qy = new Int32Array(total);
  for (let p = 0; p < total; p++) {
    if (!mask[p] || vis[p]) continue;
    let head = 0, tail = 0;
    qx[tail] = p % w; qy[tail] = Math.floor(p / w); tail++;
    vis[p] = 1;
    let area = 0;
    while (head < tail) {
      const x = qx[head], y = qy[head]; head++;
      area++;
      const neighbors = [ [x+1,y], [x-1,y], [x,y+1], [x,y-1] ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (mask[np] && !vis[np]) { vis[np] = 1; qx[tail] = nx; qy[tail] = ny; tail++; }
      }
    }
    if (area > maxBlob) maxBlob = area;
  }
  return { skinPercent: skinCount / total, largestBlob: maxBlob / total };
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
  const w = i2.width, h = i2.height, total = w*h;
  let redDom = 0, whiteInCircle = 0, blackStroke = 0, inCircleCount = 0, inRingCount = 0;
  const cx = Math.floor(w/2), cy = Math.floor(h/2);
  const r = Math.floor(Math.min(w,h)*0.3);
  for (let p = 0, idx = 0; p < total; p++, idx += i2.channels) {
    const R = d2[idx], G = d2[idx+1], B = d2[idx+2];
    if (R > 200 && G < 80 && B < 80) redDom++;
    const x = p % w, y = Math.floor(p / w);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= r) { inCircleCount++; if (R>220 && G>220 && B>220) whiteInCircle++; }
    if (dist > r*0.85 && dist < r*1.1) { inRingCount++; if (R<40 && G<40 && B<40) blackStroke++; }
  }
  const redRatio = redDom / total;
  const whiteCircleRatio = (inCircleCount ? (whiteInCircle / inCircleCount) : 0);
  const blackStrokeRatio = (inRingCount ? (blackStroke / inRingCount) : 0);
  if (redRatio > 0.45 && whiteCircleRatio > 0.6 && blackStrokeRatio > 0.08) {
    return { nazi: true, reason: 'flag_heuristic', score: { redRatio, whiteCircleRatio, blackStrokeRatio } };
  }
  return { nazi: false, reason: 'none', score: minDist };
}

// Ensure the moderation heuristics evaluate at least a medium sized canvas.
const MIN_PADDED_DIMENSION = 512;

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

function computeNudityConfidence({ skinPercent = 0, largestBlob = 0 }) {
  const skinScore = clamp((skinPercent - 0.35) / 0.45);
  const blobScore = clamp((largestBlob - 0.1) / 0.4);
  return clamp(skinScore * 0.6 + blobScore * 0.4);
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
  const nudityConfidence = computeNudityConfidence(skin);
  debug.scores.realNudity = nudityConfidence;

  const CARTOON_STRONG_THRESHOLD = 0.7;
  const CARTOON_RELAX_THRESHOLD = 0.5;

  if (nudityConfidence >= 0.6) {
    if (cartoonConfidence >= CARTOON_RELAX_THRESHOLD) {
      const allowConfidence = clamp(0.65 + (cartoonConfidence - CARTOON_RELAX_THRESHOLD) * 0.3);
      applyOutcome('ALLOW', ['animated_explicit_allowed'], allowConfidence);
    } else {
      const nudityReasons = ['real_nudity'];
      if (skin.largestBlob >= 0.4) nudityReasons.push('genitals_visible');
      if (skin.skinPercent >= 0.75) nudityReasons.push('sex_act');
      applyOutcome('BLOCK', nudityReasons, nudityConfidence);
    }
  } else if (nudityConfidence >= 0.4) {
    if (cartoonConfidence >= CARTOON_RELAX_THRESHOLD) {
      const allowConfidence = clamp(0.6 + (cartoonConfidence - CARTOON_RELAX_THRESHOLD) * 0.25);
      applyOutcome('ALLOW', ['animated_skin_visible'], allowConfidence);
    } else {
      applyOutcome('REVIEW', ['real_nudity_suspected'], nudityConfidence);
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
    } else if (cartoonConfidence >= 0.45 && nudityConfidence >= 0.3) {
      applyOutcome('REVIEW', ['animated_uncertain_age'], Math.max(cartoonConfidence, nudityConfidence));
    }
  }

  // E) quality heuristics for review
  const originalMeta = debug.metadata?.original || null;
  const normalizedMeta = debug.metadata?.normalized || null;
  const meta = originalMeta || normalizedMeta || debug.metadata || {};
  let lowResolutionOverrideRequested = false;
  if (SEVERITY_RANK[label] < SEVERITY_RANK.BLOCK) {
    const lowResolution = Boolean(
      (meta.width && meta.width < 256) || (meta.height && meta.height < 256)
    );
    if (lowResolution) {
      debug.scores.lowResolution = 0.45;
      if (lowQualityAck) {
        debug.flags = { ...debug.flags, lowResolutionOverride: true };
        lowResolutionOverrideRequested = true;
        applyOutcome('ALLOW', ['low_resolution_acknowledged'], 0.55);
      } else {
        applyOutcome('REVIEW', ['low_resolution_uncertain'], 0.45);
      }
    }
  }

  if (lowResolutionOverrideRequested && label === 'REVIEW') {
    const seriousReviewReasons = new Set(['real_nudity_suspected', 'animated_uncertain_age']);
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

