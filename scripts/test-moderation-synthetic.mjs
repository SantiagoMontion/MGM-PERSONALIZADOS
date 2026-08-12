#!/usr/bin/env node
/**
 * Synthetic smoke tests for evaluateImage (no fixture files needed).
 * Usage: node scripts/test-moderation-synthetic.mjs
 */
import sharp from 'sharp';
import { evaluateImage } from '../lib/handlers/moderateImage.js';

function assertLabel(name, result, expected) {
  const ok = result?.label === expected;
  const reasons = Array.isArray(result?.reasons) ? result.reasons.join(',') : '';
  const shape = result?.details?.scores?.nazi_shape;
  const score = result?.details?.scores?.nazi_score;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name}: got ${result?.label} (expected ${expected})`
    + (reasons ? ` [${reasons}]` : '')
    + (Number.isFinite(shape) ? ` shape=${shape.toFixed(2)}` : '')
    + (Number.isFinite(score) ? ` nazi=${score.toFixed(2)}` : ''),
  );
  if (!ok) process.exitCode = 1;
}

async function swastikaPng({ rotate = 0, flag = false } = {}) {
  const size = 512;
  const m = size / 2;
  const stroke = 48;
  const c = '#000';
  const bg = flag ? '#c00' : '#fff';
  const circle = flag
    ? `<circle cx="${m}" cy="${m}" r="${size * 0.28}" fill="#fff"/>`
    : '';
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="${bg}"/>
  ${circle}
  <g transform="rotate(${rotate}, ${m}, ${m})" fill="${c}">
    <rect x="${m - stroke / 2}" y="${m - size * 0.35}" width="${stroke}" height="${size * 0.7}"/>
    <rect x="${m - size * 0.35}" y="${m - stroke / 2}" width="${size * 0.7}" height="${stroke}"/>
    <rect x="${m + stroke * 0.5}" y="${m - size * 0.35}" width="${size * 0.2}" height="${stroke}"/>
    <rect x="${m - stroke / 2}" y="${m + stroke * 0.5}" width="${stroke}" height="${size * 0.2}"/>
    <rect x="${m - size * 0.35}" y="${m - stroke * 0.5 - size * 0.2}" width="${size * 0.2}" height="${stroke}"/>
    <rect x="${m - stroke * 0.5 - size * 0.2}" y="${m - stroke / 2}" width="${stroke}" height="${size * 0.2}"/>
  </g>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function blankPng() {
  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  }).png().toBuffer();
}

process.env.MODERATION_SKIP_OCR = process.env.MODERATION_SKIP_OCR || '1';

const axis = await evaluateImage(await swastikaPng({ rotate: 0 }), 'design.png', 'Mi pad');
assertLabel('swastika_axis', axis, 'BLOCK');

const tilted = await evaluateImage(await swastikaPng({ rotate: 45 }), 'design.png', 'Mi pad');
assertLabel('swastika_45', tilted, 'BLOCK');

const flag = await evaluateImage(await swastikaPng({ rotate: 0, flag: true }), 'pad.png', '');
assertLabel('swastika_flag', flag, 'BLOCK');

const hitlerName = await evaluateImage(await blankPng(), 'hitler-portrait.png', 'Custom');
assertLabel('hitler_filename', hitlerName, 'BLOCK');

const clean = await evaluateImage(await blankPng(), 'sunset-waves.png', 'Vacaciones');
assertLabel('innocent_blank', clean, 'ALLOW');

// Pelaje sintético (perro): tonos “piel” + textura alta + fondo variado → no bloquear
async function furryPetPhoto() {
  const w = 640;
  const h = 900;
  const buf = Buffer.alloc(w * h * 3);
  const clampCh = (v) => Math.max(0, Math.min(255, v | 0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const cx = w / 2;
      const cy = h * 0.52;
      const dx = (x - cx) / (w * 0.38);
      const dy = (y - cy) / (h * 0.42);
      if (dx * dx + dy * dy > 1) {
        buf[i] = clampCh(55 + ((x * 3 + y) % 90));
        buf[i + 1] = clampCh(95 + ((x + y * 2) % 80));
        buf[i + 2] = clampCh(35 + ((x * 5) % 55));
        continue;
      }
      const n = ((Math.sin(x * 0.35) + Math.cos(y * 0.45)) * 28) | 0;
      const n2 = ((Math.sin(x * 0.55 + y * 0.2) + Math.cos(x * 0.15 - y * 0.3)) * 22) | 0;
      const belly = dy > 0.05 && dy < 0.55 && Math.abs(dx) < 0.55;
      if (belly) {
        buf[i] = clampCh(235 + n);
        buf[i + 1] = clampCh(225 + n2);
        buf[i + 2] = clampCh(205 + n);
      } else {
        buf[i] = clampCh(200 + n);
        buf[i + 1] = clampCh(155 + n2);
        buf[i + 2] = clampCh(115 + (n / 2));
      }
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

const pet = await evaluateImage(await furryPetPhoto(), 'perrito.jpg', 'Perrito');
assertLabel('furry_pet_photo', pet, 'ALLOW');
const petFur = Number(pet?.details?.scores?.fur_likelihood || 0);
if (petFur < 0.45) {
  console.log(`FAIL furry_pet_photo fur_likelihood=${petFur} (expected >= 0.45)`);
  process.exitCode = 1;
} else {
  console.log(`PASS furry_pet_photo fur_likelihood=${petFur.toFixed(2)}`);
}

if (process.exitCode) {
  console.error('Some moderation synthetic checks failed.');
  process.exit(process.exitCode);
}
console.log('All synthetic moderation checks passed.');
