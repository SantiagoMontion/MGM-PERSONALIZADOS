#!/usr/bin/env node
import sharp from 'sharp';
import { evaluateImage } from '../lib/handlers/moderateImage.js';

process.env.MODERATION_SKIP_OCR = '1';

async function squareFlagPng() {
  const size = 512;
  const m = size / 2;
  const stroke = 48;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="#c00"/>
  <circle cx="${m}" cy="${m}" r="${size * 0.28}" fill="#fff"/>
  <g fill="#000">
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

async function padWideFlag() {
  const emblem = await sharp(await squareFlagPng()).resize(400, 400).png().toBuffer();
  return sharp({
    create: {
      width: 900,
      height: 400,
      channels: 3,
      background: { r: 204, g: 0, b: 0 },
    },
  })
    .composite([{ input: emblem, left: 250, top: 0 }])
    .png()
    .toBuffer();
}

/** Bandera estirada a 90×40 (caso típico del editor). */
async function stretchedWideFlag() {
  return sharp(await squareFlagPng()).resize(900, 400, { fit: 'fill' }).png().toBuffer();
}

for (const [name, buf] of [
  ['square_flag', await squareFlagPng()],
  ['wide_90x40_flag', await padWideFlag()],
  ['stretched_90x40_flag', await stretchedWideFlag()],
]) {
  const out = await evaluateImage(buf, 'design.png', 'Mi pad');
  console.log(name, out.label, out.reasons, {
    shape: out.details?.scores?.nazi_shape,
    palette: out.details?.scores?.nazi_palette,
    score: out.details?.scores?.nazi_score,
    minDist: out.details?.scores?.nazi_min_dist,
    alone: {
      shape: out.details?.scores?.nazi_shape_alone,
      palette: out.details?.scores?.nazi_palette_alone,
    },
  });
}
