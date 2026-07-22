import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { pHashFromGray, hamming } from '../hashing.js';
import { hateTextCheck } from '../moderation/hate.js';
import logger from '../_lib/logger.js';
import {
  applyCorsHeaders,
  ensureCors,
  handlePreflight,
  respondCorsDenied,
} from '../cors.js';

const MOD_PREVIEW_LIMIT_BYTES = Number(process.env.MOD_PREVIEW_LIMIT_BYTES ?? 2_000_000);
const BODY_LIMIT_BYTES = Number(process.env.MOD_BODY_LIMIT_BYTES ?? 8 * 1024 * 1024);

class PayloadTooLargeError extends Error {
  constructor(bytes) {
    super('payload_too_large');
    this.name = 'PayloadTooLargeError';
    this.bytes = bytes;
  }
}
function sendJson(req, res, statusCode, payload, corsDecision) {
  applyCorsHeaders(req, res, corsDecision);
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
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
  res.end(JSON.stringify(body));
}

// Tesseract en Vercel suele colgar (descarga WASM/traineddata) y deja el event loop vivo
// aunque haya timeout. En serverless solo corre si MODERATION_ENABLE_OCR=1.
const ON_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const SKIP_OCR = (
  process.env.MODERATION_SKIP_OCR === '1'
  || (ON_VERCEL && process.env.MODERATION_ENABLE_OCR !== '1')
);

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const NAZI_BLOCK_THRESHOLD = 0.6;
/** Shape solo (pHash muy cercano): BLOCK sin exigir 2 señales. */
const NAZI_SHAPE_ALONE_THRESHOLD = 0.82;
const NAZI_SHAPE_ALONE_MAX_DIST = 10;
/** Bandera nazi clásica (rojo + disco blanco): paleta sola alcanza. */
const NAZI_PALETTE_ALONE_THRESHOLD = 0.78;
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

async function readBody(req, maxBytes = BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let finished = false;

    const cleanup = () => {
      req.off?.('data', onData);
      req.off?.('end', onEnd);
      req.off?.('error', onError);
    };

    const abort = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        req.pause?.();
        req.destroy?.();
      } catch {}
      reject(err);
    };

    const onData = (chunk) => {
      if (finished) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (Number.isFinite(maxBytes) && maxBytes > 0 && total > maxBytes) {
        abort(new PayloadTooLargeError(total));
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ body, bytes: total });
      } catch (err) {
        reject(err);
      }
    };

    const onError = (err) => {
      abort(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
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

const OCR_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MODERATION_OCR_TIMEOUT_MS) || 8000,
);

function withTimeout(promise, ms, label = 'timeout') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function extractTextHints(buffer) {
  if (SKIP_OCR) return '';
  try {
    const work = (async () => {
      const { default: Tesseract } = await loadTesseract();
      const prepped = await sharp(buffer)
        .removeAlpha()
        .grayscale()
        .normalize()
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
      const result = await Tesseract.recognize(prepped, 'eng', { logger: () => {} });
      const text = result?.data?.text || '';
      return text.replace(/\s+/g, ' ').trim();
    })();
    return await withTimeout(work, OCR_TIMEOUT_MS, 'ocr_timeout');
  } catch (err) {
    return '';
  }
}

/** Score nazi solo con shape/palette (+ texto ya conocido). Sin OCR. */
function scoreNaziVisual(nazi, textSignal = 0) {
  const shapeSignal = nazi?.shapeSignal ?? 0;
  const paletteSignal = nazi?.paletteSignal ?? 0;
  const minDist = Number.isFinite(nazi?.minDist) ? nazi.minDist : Infinity;

  const positiveSignals = [];
  if (shapeSignal >= NAZI_BLOCK_THRESHOLD) positiveSignals.push(shapeSignal);
  if (paletteSignal >= NAZI_BLOCK_THRESHOLD) positiveSignals.push(paletteSignal);
  if (textSignal >= NAZI_BLOCK_THRESHOLD) positiveSignals.push(textSignal);

  const shapeStrongAlone = (
    shapeSignal >= NAZI_SHAPE_ALONE_THRESHOLD
    && minDist <= NAZI_SHAPE_ALONE_MAX_DIST
  );
  // Paleta sola solo con bandera clásica confirmada (rojo+disco+negro denso).
  // Evita bloquear arte rojo estirado / logos redondos sin símbolo.
  const paletteStrongAlone = (
    paletteSignal >= NAZI_PALETTE_ALONE_THRESHOLD
    && nazi?.palette?.classicFlagHeuristic === true
    && (nazi?.palette?.blackInDiskRatio ?? 0) >= 0.12
  );

  let naziScore = 0;
  if (shapeStrongAlone) {
    naziScore = shapeSignal;
  } else if (paletteStrongAlone) {
    naziScore = paletteSignal;
  } else if (
    positiveSignals.length >= 2
    && !(nazi?.likelyManji && paletteSignal < NAZI_BLOCK_THRESHOLD && textSignal < NAZI_BLOCK_THRESHOLD)
  ) {
    positiveSignals.sort((a, b) => b - a);
    naziScore = (positiveSignals[0] + positiveSignals[1]) / 2;
  }

  return {
    shapeSignal,
    paletteSignal,
    minDist,
    shapeStrongAlone,
    paletteStrongAlone,
    naziScore,
  };
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
  const strokes = [6, 8, 10, 12, 14];
  for (const r of rotations) {
    for (const st of strokes) {
      templates.push({ rotation: r, svg: swastikaSVG({ rotate: r, stroke: st, invert: false, flag: false }) });
      templates.push({ rotation: r, svg: swastikaSVG({ rotate: r, stroke: st, invert: true, flag: false }) });
    }
  }
  // Flag variants (red field + white disk) at common angles
  for (const r of [0, 45]) {
    for (const st of [8, 10, 12]) {
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
  // cover (center crop) evita aplastar pads anchos 90×40; la esvástica suele estar al centro.
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .resize(64, 64, { fit: 'cover', position: 'centre' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
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

  // No penalizar 0°/90°: la esvástica “normal” de diseño suele ser axis-aligned.
  const normalized = clamp(1 - Math.max(0, minDist - 6) / 26);
  const shapeSignal = clamp(normalized);

  // Resolución más alta: el downscale agresivo mezcla el disco blanco con el rojo (JPEG/foto).
  const { data: d2, info: i2 } = await sharp(buffer)
    .removeAlpha()
    .resize({ width: 320, withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = i2.width;
  const h = i2.height;
  const total = w * h;
  const channels = i2.channels;

  const samplePaletteAt = (cx, cy, radius) => {
    let redDom = 0;
    let whiteInCircle = 0;
    let blackStroke = 0;
    let brightNeutral = 0;
    let redInCircle = 0;
    let inCircleCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * channels;
        const R = d2[idx];
        const G = d2[idx + 1];
        const B = d2[idx + 2];
        const maxC = Math.max(R, G, B);
        const minC = Math.min(R, G, B);
        const isRed = R > 140 && G < 130 && B < 130 && R > G + 25 && R > B + 25;
        // Blanco / crema / off-white (fotos + JPEG); no exigir 220+.
        const isBrightNeutral = maxC > 165 && (maxC - minC) < 55 && R > 150 && G > 150 && B > 140;
        const isWhite = isBrightNeutral;
        const isBlack = R < 85 && G < 85 && B < 85 && maxC < 95;
        if (isRed) redDom++;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist <= radius) {
          inCircleCount++;
          if (isRed) redInCircle++;
          if (isWhite) whiteInCircle++;
          if (isBrightNeutral) brightNeutral++;
          if (isBlack) blackStroke++;
        }
      }
    }
    const redRatio = redDom / total;
    const whiteCircleRatio = inCircleCount ? whiteInCircle / inCircleCount : 0;
    const brightCircleRatio = inCircleCount ? brightNeutral / inCircleCount : 0;
    const blackInDiskRatio = inCircleCount ? blackStroke / inCircleCount : 0;
    const centerRedRatio = inCircleCount ? redInCircle / inCircleCount : 0;
    // Agujero claro: el centro es mucho menos rojo que el campo (disco blanco).
    const redHole = (
      redRatio >= 0.35
      && centerRedRatio < Math.min(0.35, redRatio * 0.5)
      && (brightCircleRatio >= 0.18 || whiteCircleRatio >= 0.18)
    );
    // Bandera clásica: rojo + disco claro + negro denso (esvástica ~15–40% del disco).
    // Umbral bajo de negro (~2%) disparaba falsos positivos en modo Estirar (arte rojo + logo).
    const classicFlagHeuristic = (
      redRatio >= 0.38
      && redHole
      && (whiteCircleRatio >= 0.18 || brightCircleRatio >= 0.18)
      && blackInDiskRatio >= 0.12
      && centerRedRatio < 0.35
    );
    return {
      redRatio,
      whiteCircleRatio,
      brightCircleRatio,
      blackInDiskRatio,
      centerRedRatio,
      redHole,
      classicFlagHeuristic,
    };
  };

  // Multi-centro: tras “reposicionar” el emblema puede no quedar exacto al medio.
  const radius = Math.floor(Math.min(w, h) * 0.42);
  const centers = [
    [Math.floor(w / 2), Math.floor(h / 2)],
    [Math.floor(w * 0.4), Math.floor(h / 2)],
    [Math.floor(w * 0.6), Math.floor(h / 2)],
    [Math.floor(w / 2), Math.floor(h * 0.4)],
    [Math.floor(w / 2), Math.floor(h * 0.6)],
  ];
  let bestPalette = null;
  let bestPaletteRank = -1;
  for (const [cx, cy] of centers) {
    const sample = samplePaletteAt(cx, cy, radius);
    const rank = (
      (sample.classicFlagHeuristic ? 10 : 0)
      + sample.redRatio
      + sample.whiteCircleRatio
      + sample.brightCircleRatio
      + sample.blackInDiskRatio
      - sample.centerRedRatio * 0.3
    );
    if (rank > bestPaletteRank) {
      bestPaletteRank = rank;
      bestPalette = sample;
    }
  }

  const {
    redRatio,
    whiteCircleRatio,
    brightCircleRatio,
    blackInDiskRatio,
    centerRedRatio,
    classicFlagHeuristic,
  } = bestPalette;

  const redScore = clamp((redRatio - 0.3) / 0.35);
  const whiteScore = clamp((Math.max(whiteCircleRatio, brightCircleRatio) - 0.12) / 0.4);
  // Negro debe ser denso (cruz/esvástica); trazos finos de ilustración no alcanzan.
  const blackScore = clamp((blackInDiskRatio - 0.08) / 0.2);
  let paletteSignal = clamp(redScore * 0.45 + whiteScore * 0.25 + blackScore * 0.3);

  if (classicFlagHeuristic) {
    paletteSignal = Math.max(paletteSignal, 0.92);
  }

  // Manji / cruz ambigua: shape medio sin bandera ni texto fuerte.
  const likelyManji = (
    shapeSignal >= 0.45
    && shapeSignal < NAZI_SHAPE_ALONE_THRESHOLD
    && paletteSignal < 0.45
  );

  return {
    shapeSignal,
    paletteSignal,
    minDist,
    rotation: bestRotation,
    palette: {
      redRatio,
      whiteCircleRatio,
      brightCircleRatio,
      blackInDiskRatio,
      centerRedRatio,
      classicFlagHeuristic,
    },
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
      // Solo padear imágenes chicas. Pads anchos (90×40) no deben ganar bandas blancas
      // que diluyen rojo/blanco de banderas a full-bleed.
      const minSide = Math.min(width, height);
      if (minSide > 0 && minSide < MIN_PADDED_DIMENSION && Math.max(width, height) < MIN_PADDED_DIMENSION) {
        const targetWidth = Math.max(width, MIN_PADDED_DIMENSION);
        const targetHeight = Math.max(height, MIN_PADDED_DIMENSION);
        const extraW = targetWidth - width;
        const extraH = targetHeight - height;
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

  // 1) Visual nazi primero (rápido). Si ya BLOCK → no OCR ni skin (evita timeout Vercel/Tesseract).
  const nazi = await detectNazi(workingBuffer);
  debug.nazi = nazi;

  let textSignal = textSignals.reduce((max, s) => Math.max(max, s.value), 0);
  let scored = scoreNaziVisual(nazi, textSignal);
  debug.scores.nazi_shape = scored.shapeSignal;
  debug.scores.nazi_palette = scored.paletteSignal;
  debug.scores.nazi_min_dist = Number.isFinite(scored.minDist) ? scored.minDist : null;
  debug.scores.nazi_score = scored.naziScore;
  debug.scores.nazi_shape_alone = scored.shapeStrongAlone ? 1 : 0;
  debug.scores.nazi_palette_alone = scored.paletteStrongAlone ? 1 : 0;
  debug.scores.nazi_text_signal = textSignal;

  const earlyNaziBlock = scored.naziScore >= NAZI_BLOCK_THRESHOLD;
  const earlyTextBlock = textSignal >= NAZI_BLOCK_THRESHOLD;
  if (earlyNaziBlock || earlyTextBlock) {
    if (earlyNaziBlock) blockReasons.add('extremism_nazi');
    if (earlyTextBlock) blockReasons.add('extremism_nazi_text');
    decisionConfidence = Math.max(
      decisionConfidence,
      earlyNaziBlock
        ? clamp(0.72 + scored.naziScore * 0.25)
        : clamp(0.7 + textSignal * 0.2),
    );
    debug.scores.early_exit = earlyNaziBlock ? 'nazi_visual' : 'nazi_text';
    debug.decision = 'BLOCK';
    return {
      label: 'BLOCK',
      reasons: Array.from(blockReasons),
      confidence: decisionConfidence,
      details: debug,
    };
  }

  // 2) Resto: skin/illustration en paralelo; OCR con timeout corto (fail-open).
  const [illustration, skin, textHints] = await Promise.all([
    detectIllustration(workingBuffer),
    detectSkin(workingBuffer),
    SKIP_OCR ? Promise.resolve('') : extractTextHints(workingBuffer),
  ]);
  debug.illustration = illustration;
  debug.skin = skin;
  debug.textHints = textHints.length;
  if (textHints) {
    const ocrGate = hateTextCheck({ filename, designName, textHints });
    if (ocrGate.blocked) {
      textSignals.push({ source: 'ocr', value: 0.8, reason: 'extremism_nazi_text', term: ocrGate.term });
    }
  }

  textSignal = textSignals.reduce((max, s) => Math.max(max, s.value), 0);
  debug.scores.nazi_text_signal = textSignal;
  scored = scoreNaziVisual(nazi, textSignal);
  debug.scores.nazi_score = scored.naziScore;
  debug.scores.nazi_shape_alone = scored.shapeStrongAlone ? 1 : 0;
  debug.scores.nazi_palette_alone = scored.paletteStrongAlone ? 1 : 0;

  const naziScore = scored.naziScore;
  if (naziScore >= NAZI_BLOCK_THRESHOLD) {
    blockReasons.add('extremism_nazi');
    if (textSignal >= NAZI_BLOCK_THRESHOLD) {
      blockReasons.add('extremism_nazi_text');
    }
    decisionConfidence = Math.max(decisionConfidence, clamp(0.72 + naziScore * 0.25));
  } else if (textSignal >= NAZI_BLOCK_THRESHOLD) {
    // Hitler / términos nazis directos (nombre, diseño, OCR) → BLOCK, no REVIEW.
    blockReasons.add('extremism_nazi_text');
    decisionConfidence = Math.max(decisionConfidence, clamp(0.7 + textSignal * 0.2));
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

  if (blockReasons.has('extremism_nazi') || blockReasons.has('extremism_nazi_text')) {
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
  const corsDecision = ensureCors(req, res);

  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    const diagId = randomUUID();
    try {
      logger.warn?.('[moderate-image] cors_denied', {
        diagId,
        origin: corsDecision.requestedOrigin,
      });
    } catch {}
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    handlePreflight(req, res, corsDecision);
    return;
  }

  if (req.method !== 'POST') {
    sendJson(req, res, 405, { ok: false, error: 'method_not_allowed' }, corsDecision);
    return;
  }

  try {
    let rawBody = '';
    try {
      const result = await readBody(req);
      rawBody = result?.body || '';
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        const diagId = randomUUID();
        logger.warn?.('[moderate-image] payload_too_large', {
          diagId,
          bytes: err.bytes,
          limitBytes: BODY_LIMIT_BYTES,
        });
        sendJson(req, res, 413, {
          ok: false,
          error: 'payload_too_large',
          limitBytes: BODY_LIMIT_BYTES,
          receivedBytes: err.bytes,
          preview: req?.query?.preview === '1',
          diagId,
        }, corsDecision);
        return;
      }
      logger.error?.('[moderate-image] body_read_failed', err?.message || err);
      sendJson(req, res, 400, { ok: false, reason: 'invalid_body' }, corsDecision);
      return;
    }

    let data;
    try {
      data = JSON.parse(rawBody || '{}');
    } catch {
      sendJson(req, res, 400, { ok: false, reason: 'invalid_body' }, corsDecision);
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
      sendJson(req, res, 400, { ok: false, reason: 'invalid_body' }, corsDecision);
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
        }, corsDecision);
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
      }, corsDecision);
      return;
    }

    sendJson(req, res, 200, { ok: true, ...result }, corsDecision);
  } catch (e) {
    logger.error(e);
    sendJson(req, res, 500, {
      ok: false,
      reason: 'server_error',
      error: String(e?.message || e),
    }, corsDecision);
  }
}