import sharp from 'sharp';
import { pHashFromGray, hamming } from '../hashing.js';
import { hateTextCheck } from '../moderation/hate.js';

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

export async function evaluateImage(buffer, filename, designName = '') {
  const metaGate = hateTextCheck({ filename, designName, textHints: '' });
  if (metaGate.blocked) {
    return { blocked: true, reason: 'hate_text_meta', term: metaGate.term };
  }

  // A) skin-based real nudity heuristic
  const skin = await detectSkin(buffer);
  if (process.env.DEBUG_MOD === '1') console.log('[moderation] skin', skin);
  if (skin.skinPercent >= 0.6 && skin.largestBlob >= 0.25) {
    return { blocked: true, reason: 'adult_real_nudity' };
  }
  // B) nazi detection via pHash + color heuristic
  const nazi = await detectNazi(buffer);
  if (process.env.DEBUG_MOD === '1') console.log('[moderation] nazi', nazi);
  if (nazi.nazi) return { blocked: true, reason: 'hate_symbol_nazi' };

  // C) OCR-based hate speech detection
  const textHints = await extractTextHints(buffer);
  if (textHints) {
    const textGate = hateTextCheck({ filename, designName, textHints });
    if (textGate.blocked) {
      return { blocked: true, reason: 'hate_text_ocr', term: textGate.term };
    }
  }

  return { blocked: false };
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
    if (data?.dataUrl) buffer = toBufferFromDataUrl(data.dataUrl);
    if (!buffer && data?.imageBase64) buffer = Buffer.from(data.imageBase64, 'base64');
    if (!buffer) return res.status(400).json({ ok: false, reason: 'invalid_body' });

    const out = await evaluateImage(buffer, filename, designName);
    if (out.blocked) return res.status(400).json({ ok: false, reason: out.reason });
    return res.status(200).json({ ok: true });
  } catch (e) {
    try { console.error('moderate-image error', e); } catch {}
    return res.status(500).json({ ok: false });
  }
}

