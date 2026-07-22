#!/usr/bin/env node
/**
 * Falsos positivos típicos del modo Estirar (rojo dominante + centro claro + algo de negro).
 */
import sharp from 'sharp';
import { evaluateImage } from '../lib/handlers/moderateImage.js';

process.env.MODERATION_SKIP_OCR = '1';

function assertLabel(name, result, expected) {
  const ok = result?.label === expected;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name}: got ${result?.label} (expected ${expected})`,
    {
      score: result?.details?.scores?.nazi_score,
      palette: result?.details?.scores?.nazi_palette,
      shape: result?.details?.scores?.nazi_shape,
      alone: result?.details?.scores?.nazi_palette_alone,
      ...result?.details?.nazi?.palette,
    },
  );
  if (!ok) process.exitCode = 1;
}

/** Arte rojo con personaje claro y trazos negros finos (estilo anime), estirado 90×40. */
async function redAnimeStretch() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="400">
  <rect width="100%" height="100%" fill="#c62828"/>
  <ellipse cx="450" cy="200" rx="160" ry="140" fill="#f5e6d3"/>
  <circle cx="400" cy="170" r="18" fill="#222"/>
  <circle cx="500" cy="170" r="18" fill="#222"/>
  <path d="M390 230 Q450 270 510 230" stroke="#222" stroke-width="8" fill="none"/>
  <text x="40" y="60" font-size="42" fill="#fff" font-family="Arial">GAMING</text>
  <rect x="700" y="80" width="120" height="240" fill="#111" opacity="0.35"/>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

/** Fondo rojo + disco blanco sin esvástica (logo redondo). */
async function redWhiteDiskNoSwastika() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="400">
  <rect width="100%" height="100%" fill="#c00"/>
  <circle cx="450" cy="200" r="120" fill="#fff"/>
  <text x="450" y="215" text-anchor="middle" font-size="64" fill="#222" font-family="Arial">OK</text>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

/** Bandera nazi real (debe seguir bloqueando). */
async function naziFlagStretch() {
  const size = 512;
  const m = size / 2;
  const stroke = 48;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="#c00"/>
  <circle cx="${m}" cy="${m}" r="${size * 0.28}" fill="#fff"/>
  <g fill="#000" transform="rotate(45 ${m} ${m})">
    <rect x="${m - stroke / 2}" y="${m - size * 0.35}" width="${stroke}" height="${size * 0.7}"/>
    <rect x="${m - size * 0.35}" y="${m - stroke / 2}" width="${size * 0.7}" height="${stroke}"/>
    <rect x="${m + stroke * 0.5}" y="${m - size * 0.35}" width="${size * 0.2}" height="${stroke}"/>
    <rect x="${m - stroke / 2}" y="${m + stroke * 0.5}" width="${stroke}" height="${size * 0.2}"/>
    <rect x="${m - size * 0.35}" y="${m - stroke * 0.5 - size * 0.2}" width="${size * 0.2}" height="${stroke}"/>
    <rect x="${m - stroke * 0.5 - size * 0.2}" y="${m - stroke / 2}" width="${size * 0.2}" height="${stroke}"/>
  </g>
</svg>`;
  return sharp(Buffer.from(svg)).resize(900, 400, { fit: 'fill' }).jpeg({ quality: 85 }).toBuffer();
}

assertLabel('red_anime_stretch', await evaluateImage(await redAnimeStretch(), 'design.png', 'Mi pad'), 'ALLOW');
assertLabel('red_white_disk_logo', await evaluateImage(await redWhiteDiskNoSwastika(), 'logo.png', 'Pad'), 'ALLOW');
assertLabel('nazi_flag_stretch', await evaluateImage(await naziFlagStretch(), 'flag.png', 'Pad'), 'BLOCK');

if (process.exitCode) {
  console.error('False-positive stretch checks failed.');
  process.exit(process.exitCode);
}
console.log('All stretch false-positive checks passed.');
