import sharp from 'sharp';
import { pHashFromGray, hamming } from '../hashing.js';
import { hateTextCheck } from '../moderation/hate.js';
import { getModerationConfig } from '../moderation/config.js';

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

async function detectSkin(buffer, { targetWidth = 256, originalMeta = null } = {}) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .resize({ width: targetWidth, withoutEnlargement: false })
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

  const components = [];

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
    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const bboxArea = bboxWidth * bboxHeight;
    const bboxAreaRatio = bboxArea / total;
    const component = {
      area,
      minX,
      maxX,
      minY,
      maxY,
      bboxWidth,
      bboxHeight,
      bboxArea,
      bboxAreaRatio,
      centerHits,
      centerRatio: area ? centerHits / area : 0,
      fillRatio: bboxArea ? area / bboxArea : 0,
    };
    components.push(component);

    if (area > maxBlob) {
      secondBlob = maxBlob;
      maxBlob = area;
      maxBlobBox = { minX, maxX, minY, maxY, bboxArea, bboxAreaRatio };
      maxBlobCenterHits = centerHits;
    } else if (area > secondBlob) {
      secondBlob = area;
    }
  }

  const centerSkinPercent = centerTotal ? centerSkin / centerTotal : 0;
  const largestBlobBoxArea = maxBlobBox ? maxBlobBox.bboxArea : 0;
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

  let pixelScale = 1;
  if (originalMeta?.width && originalMeta?.height) {
    const origPixels = originalMeta.width * originalMeta.height;
    const resizedPixels = w * h;
    if (resizedPixels > 0) {
      pixelScale = origPixels / resizedPixels;
    }
  }

  return {
    width: w,
    height: h,
    mask,
    skinPixels: skinCount,
    skinPercent: total ? skinCount / total : 0,
    largestBlob,
    largestBlobPixels: maxBlob,
    secondLargestBlob,
    centerSkinPercent,
    largestBlobBoxCoverage,
    largestBlobCenterRatio,
    toneVariance,
    totalPixels: total,
    components,
    pixelScale,
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

function normalizeForCorrelation(data) {
  const length = data.length;
  const normalized = new Float64Array(length);
  if (!length) return normalized;
  let mean = 0;
  for (let i = 0; i < length; i++) mean += data[i];
  mean /= length;
  let variance = 0;
  for (let i = 0; i < length; i++) {
    const diff = data[i] - mean;
    normalized[i] = diff;
    variance += diff * diff;
  }
  const denom = variance > 0 ? Math.sqrt(variance) : 1;
  for (let i = 0; i < length; i++) normalized[i] /= denom;
  return normalized;
}

function normalizedCorrelation(a, b) {
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot / len;
}

let TEMPLATES = null;
async function getTemplates() {
  if (TEMPLATES) return TEMPLATES;
  const svgs = [];
  const rotations = [0, 45, 90, 135];
  const strokes = [8, 10, 12];
  for (const r of rotations) {
    for (const st of strokes) {
      svgs.push({ svg: swastikaSVG({ rotate: r, stroke: st, invert: false, flag: false }), rotate: r, stroke: st, flag: false });
      svgs.push({ svg: swastikaSVG({ rotate: r, stroke: st, invert: true, flag: false }), rotate: r, stroke: st, flag: false, invert: true });
    }
  }
  // flags variants
  for (const r of [0]) {
    for (const st of [10]) {
      svgs.push({ svg: swastikaSVG({ rotate: r, stroke: st, invert: false, flag: true }), rotate: r, stroke: st, flag: true });
    }
  }

  const templates = [];
  for (const variant of svgs) {
    const buf = Buffer.from(variant.svg);
    const { data, info } = await sharp(buf)
      .resize(72, 72, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hash = pHashFromGray(data, info.width, info.height);
    const normalized = normalizeForCorrelation(data);
    templates.push({
      hash,
      data: normalized,
      width: info.width,
      height: info.height,
      variant,
    });
  }
  TEMPLATES = templates;
  return TEMPLATES;
}

async function extractSwastikaBoxes(buffer, meta) {
  try {
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .resize({ width: 192, height: 192, fit: 'inside', withoutEnlargement: false, background: { r: 255, g: 255, b: 255 } })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    const total = width * height;
    const mask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const v = data[i];
      mask[i] = v < 90 ? 1 : 0;
    }

    const visited = new Uint8Array(total);
    const boxes = [];
    const qx = new Int32Array(total);
    const qy = new Int32Array(total);
    for (let i = 0; i < total; i++) {
      if (!mask[i] || visited[i]) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = i % width;
      qy[tail] = Math.floor(i / width);
      visited[i] = 1;
      tail++;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      let area = 0;
      while (head < tail) {
        const x = qx[head];
        const y = qy[head];
        head++;
        area++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        const neighbors = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const idx = ny * width + nx;
          if (!mask[idx] || visited[idx]) continue;
          visited[idx] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }

      const bboxWidth = maxX - minX + 1;
      const bboxHeight = maxY - minY + 1;
      const bboxArea = bboxWidth * bboxHeight;
      const areaRatio = bboxArea / total;
      if (areaRatio < 0.01 || areaRatio > 0.4) continue;

      const norm = {
        x0: minX / width,
        y0: minY / height,
        x1: (maxX + 1) / width,
        y1: (maxY + 1) / height,
      };
      const scaleX = meta?.width ? meta.width : width;
      const scaleY = meta?.height ? meta.height : height;
      boxes.push({
        normalized: norm,
        pixels: {
          x: Math.round(norm.x0 * scaleX),
          y: Math.round(norm.y0 * scaleY),
          width: Math.round((norm.x1 - norm.x0) * scaleX),
          height: Math.round((norm.y1 - norm.y0) * scaleY),
        },
        areaRatio,
        area,
      });
    }
    return boxes;
  } catch {
    return [];
  }
}

async function detectNazi(buffer, { config, meta, originalBuffer } = {}) {
  const templates = await getTemplates();
  const analysisBuffer = await sharp(buffer)
    .removeAlpha()
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: false, background: { r: 255, g: 255, b: 255 } })
    .toBuffer();

  const rotations = [0, 45, 90, 135, 180, 225, 270, 315];
  const matches = [];
  let topScore = 0;
  let minDist = Infinity;

  for (const rotation of rotations) {
    const { data, info } = await sharp(analysisBuffer)
      .rotate(rotation, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .resize(64, 64, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const hash = pHashFromGray(data, info.width, info.height);
    const normalized = normalizeForCorrelation(data);

    for (const template of templates) {
      const dist = hamming(hash, template.hash);
      const hashScore = clamp(1 - dist / 32);
      if (dist < minDist) minDist = dist;
      if (hashScore < 0.35) continue;
      const corr = normalizedCorrelation(normalized, template.data);
      const corrScore = clamp((corr - 0.35) / 0.65);
      const confidence = clamp(hashScore * 0.6 + corrScore * 0.4);
      if (confidence <= 0.2) continue;
      matches.push({
        confidence,
        rotation,
        hashScore,
        corrScore,
        dist,
        template: template.variant,
      });
      if (confidence > topScore) topScore = confidence;
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  const strongMatches = matches.filter((m) => m.confidence >= (config?.SWASTIKA_DET_THRESH ?? 0.6));
  const mediumMatches = matches.filter((m) => m.confidence >= 0.5);
  let block = strongMatches.length > 0 || mediumMatches.length >= 2;
  const boxes = await extractSwastikaBoxes(analysisBuffer, meta);

  let reason = block ? 'detector' : 'none';
  let colorCheck = null;
  if (!block) {
    const colorSource = originalBuffer || buffer;
    colorCheck = await detectNaziColors(colorSource, minDist);
    if (colorCheck.block) {
      block = true;
      reason = colorCheck.reason;
    }
  }

  return {
    nazi: block,
    block,
    reason,
    score: block ? Math.max(topScore, colorCheck?.scoreValue ?? 0) : topScore,
    matches: matches.slice(0, 6),
    boundingBoxes: boxes,
    color: colorCheck,
  };
}

async function detectNaziColors(buffer, minDist) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const total = w * h;
  let redDom = 0;
  let whiteInCircle = 0;
  let blackStroke = 0;
  let inCircle = 0;
  let inRing = 0;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const r = Math.floor(Math.min(w, h) * 0.3);
  for (let idx = 0, p = 0; p < total; p++, idx += info.channels) {
    const R = data[idx];
    const G = data[idx + 1];
    const B = data[idx + 2];
    const isRed = R > 180 && G < 110 && B < 110;
    const isWhite = R > 215 && G > 215 && B > 215;
    const isBlack = R < 70 && G < 70 && B < 70;
    if (isRed) redDom++;
    const x = p % w;
    const y = Math.floor(p / w);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= r) {
      inCircle++;
      if (isWhite) whiteInCircle++;
    }
    if (dist > r * 0.85 && dist < r * 1.15) {
      inRing++;
      if (isBlack) blackStroke++;
    }
  }
  const redRatio = total ? redDom / total : 0;
  const whiteCircleRatio = inCircle ? whiteInCircle / inCircle : 0;
  const blackStrokeRatio = inRing ? blackStroke / inRing : 0;
  const thresholds = {
    red: 0.45,
    white: 0.45,
    black: 0.18,
    minDist: 26,
  };
  const matchesColor =
    redRatio >= thresholds.red &&
    whiteCircleRatio >= thresholds.white &&
    blackStrokeRatio >= thresholds.black &&
    (minDist ?? Infinity) <= thresholds.minDist;
  return {
    block: matchesColor,
    reason: matchesColor ? 'color_flag' : 'none',
    metrics: { redRatio, whiteCircleRatio, blackStrokeRatio, minDist },
    scoreValue: matchesColor ? Math.max(redRatio, whiteCircleRatio, blackStrokeRatio) : 0,
  };
}

function toPersonFromComponent(component, skin, meta) {
  const totalPixels = skin.totalPixels || 1;
  const x0 = component.minX / skin.width;
  const y0 = component.minY / skin.height;
  const x1 = (component.maxX + 1) / skin.width;
  const y1 = (component.maxY + 1) / skin.height;
  const scaleX = meta?.width ? meta.width : skin.width;
  const scaleY = meta?.height ? meta.height : skin.height;
  const bboxPixels = component.bboxArea * skin.pixelScale;
  const skinPixels = component.area * skin.pixelScale;
  const aspect = component.bboxHeight / Math.max(1, component.bboxWidth);
  const areaRatio = component.area / totalPixels;
  const bboxAreaRatio = component.bboxArea / totalPixels;
  const areaScore = clamp((areaRatio - 0.015) / 0.35);
  const fillScore = clamp((component.fillRatio - 0.18) / 0.55);
  const centerScore = clamp((component.centerRatio - 0.15) / 0.45);
  const aspectScore = clamp(1 - Math.abs(Math.log(aspect || 1) / Math.log(3)));
  const tallScore = clamp((component.bboxHeight / skin.height - 0.25) / 0.6);
  const confidence = clamp(areaScore * 0.28 + fillScore * 0.24 + centerScore * 0.22 + aspectScore * 0.12 + tallScore * 0.14);
  return {
    confidence,
    areaRatio,
    bboxAreaRatio,
    fillRatio: component.fillRatio,
    centerRatio: component.centerRatio,
    bbox: {
      x0,
      y0,
      x1,
      y1,
      width: x1 - x0,
      height: y1 - y0,
    },
    bboxPixels,
    skinPixels,
    aspect,
    component,
    originalPixels: {
      x: Math.round(x0 * scaleX),
      y: Math.round(y0 * scaleY),
      width: Math.round((x1 - x0) * scaleX),
      height: Math.round((y1 - y0) * scaleY),
    },
  };
}

function estimatePersonsFromSkin(skin, meta, config) {
  if (!skin?.components?.length) return [];
  const candidates = skin.components
    .filter((c) => c.area / skin.totalPixels >= 0.01)
    .map((component) => toPersonFromComponent(component, skin, meta));
  candidates.sort((a, b) => b.confidence - a.confidence);
  // Keep top components but limit to avoid noise
  return candidates.slice(0, 8).map((person) => ({ ...person, threshold: config?.PERSON_DET_THRESH ?? 0.5 }));
}

function computePersonSkinStats(persons, skin) {
  if (!persons?.length) {
    return {
      maxSkinRatio: 0,
      skinIntersection: 0,
      totalSkinInPersons: 0,
      largestRegionPixels: skin?.largestBlobPixels ? skin.largestBlobPixels * skin.pixelScale : 0,
    };
  }
  let maxSkinRatio = 0;
  let totalSkin = 0;
  for (const person of persons) {
    const skinRatio = person.component?.bboxArea ? person.component.area / person.component.bboxArea : 0;
    if (skinRatio > maxSkinRatio) maxSkinRatio = skinRatio;
    totalSkin += person.component?.area || 0;
  }
  const skinIntersection = skin?.skinPixels ? totalSkin / skin.skinPixels : 0;
  return {
    maxSkinRatio,
    skinIntersection,
    totalSkinInPersons: totalSkin * (skin?.pixelScale || 1),
    largestRegionPixels: skin?.largestBlobPixels ? skin.largestBlobPixels * (skin?.pixelScale || 1) : 0,
  };
}

async function computeColorStats(buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .resize({ width: 192, height: 192, fit: 'inside', withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  let pink = 0;
  let lumaSum = 0;
  let lumaSq = 0;
  for (let i = 0; i < total; i++) {
    const idx = i * info.channels;
    const R = data[idx] / 255;
    const G = data[idx + 1] / 255;
    const B = data[idx + 2] / 255;
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const delta = max - min;
    let hue = 0;
    if (delta > 1e-5) {
      if (max === R) hue = ((G - B) / delta) % 6;
      else if (max === G) hue = (B - R) / delta + 2;
      else hue = (R - G) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    const saturation = max === 0 ? 0 : delta / max;
    const value = max;
    const luma = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    lumaSum += luma;
    lumaSq += luma * luma;
    const isPink =
      saturation >= 0.22 &&
      value >= 0.25 &&
      ((hue >= 285 && hue <= 345) || (hue >= 330 || hue <= 20) || (R > 0.7 && B > 0.4 && G < 0.6));
    if (isPink) pink++;
  }
  const pinkRatio = total ? pink / total : 0;
  const meanLuma = total ? lumaSum / total : 0;
  const lumaVariance = total ? Math.max(0, lumaSq / total - meanLuma * meanLuma) : 0;
  return { pinkRatio, meanLuma, lumaVariance };
}

async function analyzeTexture(buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .grayscale()
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let strongEdges = 0;
  let considered = 0;
  const cells = 8;
  const cellEdges = new Float64Array(cells * cells);
  const cellTotals = new Float64Array(cells * cells);
  const cellWidth = width / cells;
  const cellHeight = height / cells;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -data[idx - width - 1] - 2 * data[idx - 1] - data[idx + width - 1] + data[idx - width + 1] + 2 * data[idx + 1] + data[idx + width + 1];
      const gy =
        -data[idx - width - 1] - 2 * data[idx - width] - data[idx - width + 1] + data[idx + width - 1] + 2 * data[idx + width] + data[idx + width + 1];
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      const cellX = Math.min(cells - 1, Math.floor(x / cellWidth));
      const cellY = Math.min(cells - 1, Math.floor(y / cellHeight));
      const cellIndex = cellY * cells + cellX;
      cellTotals[cellIndex] += 1;
      if (magnitude >= 120) {
        strongEdges++;
        cellEdges[cellIndex] += 1;
      }
      considered++;
    }
  }
  const edgeDensity = considered ? strongEdges / considered : 0;
  let distributedCells = 0;
  for (let i = 0; i < cellEdges.length; i++) {
    const total = cellTotals[i] || 1;
    const ratio = cellEdges[i] / total;
    if (ratio >= 0.04) distributedCells++;
  }
  const distributedRatio = cellEdges.length ? distributedCells / cellEdges.length : 0;
  return { edgeDensity, distributedRatio };
}

function analyzeOcrText(text, geoKeywords) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const normalizedTokens = tokens.map((t) => t.replace(/[^\p{L}0-9]+/gu, '').toLowerCase()).filter(Boolean);
  let geoHits = 0;
  for (const token of normalizedTokens) {
    for (const geo of geoKeywords) {
      if (token.includes(geo.toLowerCase())) {
        geoHits++;
        break;
      }
    }
  }
  return { tokenCount: tokens.length, geoHits };
}

function evaluateInhibitors({
  hasPerson,
  pinkRatio,
  colorStats,
  texture,
  skin,
  ocr,
  config,
}) {
  const reasons = [];
  if (!hasPerson && pinkRatio >= (config?.PINK_DOMINANCE ?? 0.55)) {
    reasons.push('pink_dominant_no_person');
  }
  if (!hasPerson && ocr?.tokenCount >= (config?.OCR_TOKEN_MIN ?? 100) && ocr?.geoHits >= (config?.OCR_GEOS_MIN ?? 5)) {
    reasons.push('map_text_detected');
  }
  const largeRegionPixels = skin?.largestBlobPixels ? skin.largestBlobPixels * (skin?.pixelScale || 1) : 0;
  if (
    !hasPerson &&
    texture?.edgeDensity >= 0.12 &&
    texture?.distributedRatio >= 0.55 &&
    largeRegionPixels < (config?.SKIN_LARGE_REGION ?? 20000)
  ) {
    reasons.push('dense_edges_document');
  }
  if (
    !hasPerson &&
    (skin?.skinPercent ?? 0) >= 0.45 &&
    (skin?.toneVariance ?? 1) <= 0.15 &&
    (colorStats?.lumaVariance ?? 0) <= 0.01
  ) {
    reasons.push('uniform_skin_like_background');
  }

  return { allow: reasons.length > 0, reasons };
}

async function persistFalsePositiveSample(buffer, meta = {}) {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !serviceRole) return false;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supa = createClient(url, serviceRole, { auth: { persistSession: false } });
    const bucket = process.env.MODERATION_FP_BUCKET || 'moderation';
    const date = new Date();
    const folder = `fp-rosa/${date.toISOString().slice(0, 10)}`;
    const key = `${folder}/${(meta.filename || 'image').replace(/[^a-z0-9._-]+/gi, '_')}-${date.getTime()}.png`;
    await supa.storage.from(bucket).upload(key, buffer, {
      contentType: 'image/png',
      upsert: false,
    });
    return true;
  } catch (err) {
    console.warn('moderation.fp_archive_failed', err?.message || err);
    return false;
  }
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
  const config = getModerationConfig(options?.thresholdOverrides);
  const debug = {
    metadata: null,
    skin: null,
    illustration: null,
    nazi: null,
    textHints: 0,
    scores: {},
    persons: [],
    inhibitors: null,
    ocr: null,
    texture: null,
    color: null,
  };
  const logRecord = {
    hasPerson: false,
    nsfw: 0,
    skinInPerson: 0,
    pinkRatio: 0,
    ocrTokens: 0,
    geoHits: 0,
    naziScore: 0,
    decision: 'ALLOW',
  };

  let workingBuffer = buffer;
  let prepared = null;

  try {
    prepared = await prepareModerationImage(buffer);
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

  const nazi = await detectNazi(workingBuffer, { config, meta: prepared?.meta, originalBuffer: buffer });
  debug.nazi = nazi;
  logRecord.naziScore = nazi?.score ?? 0;
  if (nazi?.block) {
    const base = config?.SWASTIKA_DET_THRESH ?? 0.6;
    const confidence = clamp(0.75 + Math.max(0, (nazi.score || base) - base) * 0.25);
    markBlocked('extremism_nazi', confidence);
  }

  const illustration = await detectIllustration(workingBuffer);
  let realnessScore = clamp(1 - (illustration?.cartoonConfidence ?? 0));
  debug.illustration = { ...illustration, realnessScore };
  debug.scores.realness = realnessScore;

  const skin = await detectSkin(workingBuffer, { targetWidth: 256, originalMeta: prepared?.meta });
  debug.skin = skin;

  const nudityConfidence = computeNudityConfidence(skin);
  debug.scores.nudityHeuristic = nudityConfidence;

  const persons = estimatePersonsFromSkin(skin, prepared?.meta, config);
  debug.persons = persons;
  const validPersons = persons.filter(
    (p) => p.confidence >= (config?.PERSON_DET_THRESH ?? 0.5) && p.bboxAreaRatio >= 0.02
  );
  const hasPerson = validPersons.length > 0;
  logRecord.hasPerson = hasPerson;

  const colorStats = await computeColorStats(workingBuffer);
  debug.color = colorStats;
  logRecord.pinkRatio = colorStats.pinkRatio;

  const texture = await analyzeTexture(workingBuffer);
  debug.texture = texture;

  const personSkinStats = computePersonSkinStats(validPersons, skin);
  debug.personSkin = personSkinStats;
  logRecord.skinInPerson = personSkinStats.maxSkinRatio;

  if (personSkinStats.maxSkinRatio >= 0.25 && (skin?.skinPercent ?? 0) >= 0.3) {
    const boost = clamp(nudityConfidence * 0.7 + personSkinStats.maxSkinRatio * 0.4);
    realnessScore = Math.max(realnessScore, boost);
    debug.scores.realness = realnessScore;
    debug.illustration = { ...illustration, realnessScore };
  }

  const isRealPhoto = realnessScore >= (config?.REALNESS_THRESH ?? 0.6);
  debug.flags = { isRealPhoto, hasPerson };

  let nsfwScore = 0;
  let nsfwCandidate = null;
  let gateChecks = { meetsSkinRatio: false, meetsIntersection: false, meetsLargeRegion: false };

  if (isRealPhoto && hasPerson) {
    nsfwScore = nudityConfidence;
    gateChecks = {
      meetsSkinRatio: personSkinStats.maxSkinRatio >= (config?.SKIN_RATIO_IN_PERSON ?? 0.12),
      meetsIntersection: personSkinStats.skinIntersection >= (config?.SKIN_INTERSECTION ?? 0.6),
      meetsLargeRegion: personSkinStats.largestRegionPixels >= (config?.SKIN_LARGE_REGION ?? 20000),
    };
    if (nsfwScore >= (config?.NSFW_THRESH ?? 0.7) && gateChecks.meetsSkinRatio && gateChecks.meetsIntersection && gateChecks.meetsLargeRegion) {
      const confidence = clamp(0.65 + (nsfwScore - (config?.NSFW_THRESH ?? 0.7)) * 0.35);
      nsfwCandidate = { reason: 'real_nudity', confidence };
    }
  }
  debug.scores.nsfw = nsfwScore;
  debug.scores.nsfwGates = gateChecks;
  logRecord.nsfw = nsfwScore;

  let ocrStats = { tokenCount: 0, geoHits: 0 };
  let textHints = '';
  const shouldRunOcr = !hasPerson && colorStats.pinkRatio >= 0.4;
  if (shouldRunOcr) {
    textHints = await extractTextHints(workingBuffer);
    debug.textHints = textHints.length;
    if (textHints) {
      ocrStats = analyzeOcrText(textHints, config.GEO_KEYWORDS || []);
      const ocrGate = hateTextCheck({ filename, designName, textHints });
      if (ocrGate.blocked) {
        markBlocked('extremism_nazi_text', 0.82);
      }
    }
  } else {
    debug.textHints = 0;
  }
  debug.ocr = ocrStats;
  logRecord.ocrTokens = ocrStats.tokenCount;
  logRecord.geoHits = ocrStats.geoHits;

  const inhibitors = evaluateInhibitors({
    hasPerson,
    pinkRatio: colorStats.pinkRatio,
    colorStats,
    texture,
    skin,
    ocr: ocrStats,
    config,
  });
  debug.inhibitors = inhibitors;

  if (nsfwCandidate) {
    if (inhibitors.allow) {
      debug.scores.nsfwInhibited = true;
      await persistFalsePositiveSample(workingBuffer, {
        filename,
        designName,
        nsfwScore,
      });
      nsfwCandidate = null;
    } else {
      markBlocked(nsfwCandidate.reason, nsfwCandidate.confidence);
    }
  }

  const allowReasons = [];
  if (!isRealPhoto) allowReasons.push('non_real_photo');
  if (isRealPhoto && !hasPerson) allowReasons.push('no_person_detected');
  if (inhibitors.allow) allowReasons.push('pink_inhibitor');

  if (blockReasons.size) {
    logRecord.decision = 'BLOCK';
    console.info('moderation.image', { ...logRecord, filename });
    return {
      label: 'BLOCK',
      reasons: Array.from(blockReasons),
      confidence: blockConfidence || 0.65,
      details: debug,
    };
  }

  const confidenceBase = isRealPhoto ? 0.72 : 0.78;
  const confidence = clamp(confidenceBase + Math.max(0, 0.5 - colorStats.pinkRatio) * 0.06);
  const reasons = allowReasons.length ? allowReasons : ['no_violation_detected'];

  logRecord.decision = 'ALLOW';
  console.info('moderation.image', { ...logRecord, filename });

  return {
    label: 'ALLOW',
    reasons,
    confidence,
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