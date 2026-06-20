import sharp from 'sharp';

const DPI = 300;

export async function composeImage({ render_v2, srcBuf }) {
  const c = render_v2.canvas_px;
  const pad = render_v2.pad_px;
  const p = render_v2.place_px;
  const bleed_cm = (render_v2.bleed_mm || 0) / 10;
  const inner_w_px = Math.round((render_v2.w_cm * DPI) / 2.54);
  const inner_h_px = Math.round((render_v2.h_cm * DPI) / 2.54);
  const bleed_px = Math.round((bleed_cm * DPI) / 2.54);
  const out_w_px = inner_w_px + 2 * bleed_px;
  const out_h_px = inner_h_px + 2 * bleed_px;
  const scaleX = inner_w_px / pad.w;
  const scaleY = inner_h_px / pad.h;
  const scale = Math.min(scaleX, scaleY);
  const place_rel = { x: p.x - pad.x, y: p.y - pad.y };
  const targetW = Math.round(p.w * scale);
  const targetH = Math.round(p.h * scale);
  let destX = bleed_px + Math.round(place_rel.x * scale);
  let destY = bleed_px + Math.round(place_rel.y * scale);

  const isCircle = String(render_v2.shape || '').trim().toLowerCase() === 'circle';
  const isContain = render_v2.fit_mode === 'contain' && render_v2.bg_hex;
  const bgHex = isCircle
    ? (isContain ? render_v2.bg_hex : { r: 0, g: 0, b: 0, alpha: 0 })
    : (isContain ? render_v2.bg_hex : '#000000');

  const srcRot = await sharp(srcBuf)
    .rotate(render_v2.rotate_deg ?? 0)
    .toBuffer();
  const resized = await sharp(srcRot)
    .resize({ width: targetW, height: targetH, fit: 'fill' })
    .toBuffer();

  const cutLeft = Math.max(0, -destX);
  const cutTop = Math.max(0, -destY);
  const cutRight = Math.max(0, destX + targetW - out_w_px);
  const cutBottom = Math.max(0, destY + targetH - out_h_px);

  const clipX = cutLeft;
  const clipY = cutTop;
  const clipW = targetW - cutLeft - cutRight;
  const clipH = targetH - cutTop - cutBottom;
  if (clipW <= 0 || clipH <= 0) {
    const debug = {
      canvas_px: c,
      pad_px: pad,
      place_px: p,
      place_rel,
      inner_w_px,
      inner_h_px,
      out_w_px,
      out_h_px,
      bleed_px,
      scaleX,
      scaleY,
      scale,
      destX,
      destY,
      targetW,
      targetH,
      clipX,
      clipY,
      clipW,
      clipH,
    };
    const err = new Error('invalid_bbox');
    err.debug = debug;
    throw err;
  }

  const layer = await sharp(resized)
    .extract({ left: clipX, top: clipY, width: clipW, height: clipH })
    .toBuffer();

  destX = Math.max(0, destX);
  destY = Math.max(0, destY);

  const base = await sharp({
    create: { width: out_w_px, height: out_h_px, channels: 4, background: bgHex },
  })
    .png()
    .toBuffer();
  let composed = await sharp(base)
    .composite([{ input: layer, left: destX, top: destY }])
    .png()
    .toBuffer();

  const radiusScaled = 0;
  const circleCx = bleed_px + inner_w_px / 2;
  const circleCy = bleed_px + inner_h_px / 2;
  const circleR = Math.min(inner_w_px, inner_h_px) / 2;
  const maskSvg = isCircle
    ? `<svg width="${out_w_px}" height="${out_h_px}" xmlns="http://www.w3.org/2000/svg"><circle cx="${circleCx}" cy="${circleCy}" r="${circleR}" fill="#ffffff"/></svg>`
    : `<svg width="${out_w_px}" height="${out_h_px}" viewBox="0 0 ${out_w_px} ${out_h_px}"><rect x="0" y="0" width="${out_w_px}" height="${out_h_px}" rx="${radiusScaled}" ry="${radiusScaled}" fill="#fff"/></svg>`;
  const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer();
  composed = await sharp(composed)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  let printBuf;
  let innerBuf;
  if (isCircle) {
    printBuf = composed;
    innerBuf = await sharp(composed)
      .extract({ left: bleed_px, top: bleed_px, width: inner_w_px, height: inner_h_px })
      .png()
      .toBuffer();
  } else {
    printBuf = await sharp(composed)
      .flatten({ background: bgHex })
      .png()
      .toBuffer();
    innerBuf = await sharp(composed)
      .extract({ left: bleed_px, top: bleed_px, width: inner_w_px, height: inner_h_px })
      .flatten({ background: bgHex })
      .toBuffer();
  }

  const debug = {
    canvas_px: c,
    pad_px: pad,
    place_px: p,
    place_rel,
    inner_w_px,
    inner_h_px,
    out_w_px,
    out_h_px,
    bleed_px,
    scaleX,
    scaleY,
    scale,
    destX,
    destY,
    targetW,
    targetH,
    clipX,
    clipY,
    clipW,
    clipH,
    isCircle,
  };

  return { innerBuf, printBuf, debug };
}

export default composeImage;
