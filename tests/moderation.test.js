import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODERATION_SKIP_OCR = '1';

const { evaluateImage } = await import('../lib/handlers/moderateImage.js');

async function createSyntheticNudityBuffer() {
  const width = 512;
  const height = 512;
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  const cx = width / 2;
  const cy = height / 2;
  const radiusX = width * 0.38;
  const radiusY = height * 0.44;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const nx = (x - cx) / radiusX;
      const ny = (y - cy) / radiusY;
      const inside = nx * nx + ny * ny <= 1;
      if (inside) {
        const noise = Math.sin(x * 0.025) * 6 + Math.cos(y * 0.018) * 4;
        const baseR = 210 + noise;
        const baseG = 170 + noise * 0.6;
        const baseB = 140 + noise * 0.35;
        data[idx] = Math.max(0, Math.min(255, Math.round(baseR)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseG)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseB)));
      } else {
        const bg = 28 + ((x + y) % 5);
        data[idx] = bg;
        data[idx + 1] = bg + 2;
        data[idx + 2] = bg + 4;
      }
    }
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function createNeutralBuffer() {
  return sharp({
    create: {
      width: 320,
      height: 320,
      channels: 3,
      background: { r: 45, g: 90, b: 140 },
    },
  })
    .png()
    .toBuffer();
}

async function createCartoonBuffer() {
  const width = 512;
  const height = 512;
  const channels = 3;
  const tile = 8;
  const data = Buffer.alloc(width * height * channels);
  const colorA = [240, 190, 200];
  const colorB = [60, 30, 140];

  for (let y = 0; y < height; y++) {
    const tileY = Math.floor(y / tile);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const tileX = Math.floor(x / tile);
      const source = (tileX + tileY) % 2 === 0 ? colorA : colorB;
      data[idx] = source[0];
      data[idx + 1] = source[1];
      data[idx + 2] = source[2];
    }
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function createStylizedCharacterBuffer() {
  const width = 512;
  const height = 512;
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  const ellipses = [
    { x: width * 0.52, y: height * 0.6, rx: width * 0.12, ry: height * 0.3 },
    { x: width * 0.48, y: height * 0.33, rx: width * 0.095, ry: height * 0.12 },
    { x: width * 0.84, y: height * 0.56, rx: width * 0.09, ry: height * 0.17 },
    { x: width * 0.18, y: height * 0.62, rx: width * 0.1, ry: height * 0.18 },
    { x: width * 0.5, y: height * 0.82, rx: width * 0.1, ry: height * 0.12 },
  ];

  const isInsideEllipse = (x, y, ellipse) => {
    const nx = (x - ellipse.x) / ellipse.rx;
    const ny = (y - ellipse.y) / ellipse.ry;
    return nx * nx + ny * ny <= 1;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const inSkin = ellipses.some((ellipse) => isInsideEllipse(x, y, ellipse));
      if (inSkin) {
        const shade = Math.sin((x + y) * 0.022) * 11 + Math.cos((x - y) * 0.019) * 7;
        const baseR = 214 + shade;
        const baseG = 175 + shade * 0.62;
        const baseB = 148 + shade * 0.4;
        data[idx] = Math.max(0, Math.min(255, Math.round(baseR)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseG)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseB)));
        continue;
      }

      const inSuit =
        y > height * 0.4 &&
        y < height * 0.88 &&
        Math.abs(x - width * 0.52) < width * 0.26;

      if (inSuit) {
        const hue = (Math.sin(x * 0.024) + Math.cos(y * 0.021)) * 0.4;
        const baseR = 48 + hue * 35 + (y / height) * 8;
        const baseG = 94 + hue * 55 + (x / width) * 6;
        const baseB = 130 + hue * 62 + (x / width) * 14;
        data[idx] = Math.max(0, Math.min(255, Math.round(baseR)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseG)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseB)));
        continue;
      }

      const bgNoise = Math.sin(x * 0.015) * Math.cos(y * 0.017);
      const baseR = 36 + bgNoise * 36 + (x / width) * 20;
      const baseG = 20 + bgNoise * 28 + (y / height) * 14;
      const baseB = 55 + bgNoise * 45 + (y / height) * 18;
      data[idx] = Math.max(0, Math.min(255, Math.round(baseR)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseG)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseB)));
    }
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

function swastikaSVG({ size = 256, stroke = 26, flag = true, rotate = 45 } = {}) {
  const s = size;
  const m = s / 2;
  const bg = flag ? '#c00' : '#fff';
  const circle = flag
    ? `<circle cx="${m}" cy="${m}" r="${s * 0.34}" fill="#fff" stroke="#000" stroke-width="${Math.max(
        2,
        s * 0.04,
      )}"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">\n  <rect width="100%" height="100%" fill="${bg}"/>\n  ${circle}\n  <g transform="rotate(${rotate}, ${m}, ${m})" fill="#000">\n    <rect x="${m - stroke / 2}" y="${m - s * 0.36}" width="${stroke}" height="${s * 0.72}"/>\n    <rect x="${m - s * 0.36}" y="${m - stroke / 2}" width="${s * 0.72}" height="${stroke}"/>\n    <rect x="${m + stroke * 0.45}" y="${m - s * 0.36}" width="${s * 0.2}" height="${stroke}"/>\n    <rect x="${m - stroke / 2}" y="${m + stroke * 0.45}" width="${stroke}" height="${s * 0.2}"/>\n    <rect x="${m - s * 0.36}" y="${m - stroke * 0.45 - s * 0.2}" width="${s * 0.2}" height="${stroke}"/>\n    <rect x="${m - stroke * 0.45 - s * 0.2}" y="${m - stroke / 2}" width="${stroke}" height="${s * 0.2}"/>\n  </g>\n</svg>`;
}

async function createSwastikaBuffer() {
  const svg = swastikaSVG();
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('evaluateImage blocks obvious skin exposure', async () => {
  const buf = await createSyntheticNudityBuffer();
  const result = await evaluateImage(buf, 'design.png');
  assert.equal(result.label, 'BLOCK');
  assert(result.reasons.includes('real_nudity'));
  assert(result.confidence >= 0.62);
});

test('evaluateImage allows neutral graphics', async () => {
  const buf = await createNeutralBuffer();
  const result = await evaluateImage(buf, 'poster.png');
  assert.equal(result.label, 'ALLOW');
  assert.equal(result.reasons.includes('no_violation_detected'), true);
});

test('evaluateImage allows stylized explicit art', async () => {
  const buf = await createCartoonBuffer();
  const result = await evaluateImage(buf, 'stylized.png', '', { approxDpi: 320 });
  assert.equal(result.label, 'ALLOW');
  assert.equal(result.reasons.includes('no_violation_detected'), true);
  assert(result.confidence >= 0.7);
});

test('evaluateImage allows stylized character renders', async () => {
  const buf = await createStylizedCharacterBuffer();
  const result = await evaluateImage(buf, 'character.png', '', { approxDpi: 320 });
  assert.equal(result.label, 'ALLOW');
  assert.equal(result.reasons.includes('no_violation_detected'), true);
  assert(result.confidence >= 0.7);
});

test('evaluateImage blocks nazi symbols', async () => {
  const buf = await createSwastikaBuffer();
  const result = await evaluateImage(buf, 'flag.png');
  assert.equal(result.label, 'BLOCK');
  assert(result.reasons.includes('extremism_nazi'));
});

test('evaluateImage flags nazi text metadata for review', async () => {
  const buf = await createNeutralBuffer();
  const result = await evaluateImage(buf, 'safe.png', 'Heil Hitler banner');
  assert.equal(result.label, 'REVIEW');
  assert(result.reasons.includes('extremism_nazi_text'));
});

