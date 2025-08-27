import sharp from 'sharp';

export type ComposeResult = {
  innerBuf: Buffer;
  printBuf: Buffer;
  debug: Record<string, any>;
};

const DPI = 300;

export async function composeImage({ render_v2, srcBuf }: { render_v2: any; srcBuf: Buffer; }): Promise<ComposeResult> {
  const c = render_v2.canvas_px;
  const p = render_v2.place_px;
  const bleed_cm = (render_v2.bleed_mm || 0) / 10;
  const inner_w_px = Math.round((render_v2.w_cm * DPI) / 2.54);
  const inner_h_px = Math.round((render_v2.h_cm * DPI) / 2.54);
  const bleed_px = Math.round((bleed_cm * DPI) / 2.54);
  const out_w_px = inner_w_px + 2 * bleed_px;
  const out_h_px = inner_h_px + 2 * bleed_px;
  const scaleX = inner_w_px / c.w;
  const scaleY = inner_h_px / c.h;
  const scale = Math.min(scaleX, scaleY);
  const targetW = Math.round(p.w * scale);
  const targetH = Math.round(p.h * scale);
  let destX = bleed_px + Math.round(p.x * scale);
  let destY = bleed_px + Math.round(p.y * scale);

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
      inner_w_px,
      inner_h_px,
      out_w_px,
      out_h_px,
      bleed_px,
      scaleX,
      scaleY,
      scale,
      place: p,
      dest: { x: destX, y: destY },
      targetW,
      targetH,
      clip: { x: clipX, y: clipY, w: clipW, h: clipH },
    };
    const err: any = new Error('invalid_bbox');
    err.debug = debug;
    throw err;
  }

  const layer = await sharp(resized)
    .extract({ left: clipX, top: clipY, width: clipW, height: clipH })
    .toBuffer();

  destX = Math.max(0, destX);
  destY = Math.max(0, destY);

  const bgHex =
    render_v2.fit_mode === 'contain' && render_v2.bg_hex
      ? render_v2.bg_hex
      : '#000000';
  const base = await sharp({
    create: { width: out_w_px, height: out_h_px, channels: 3, background: bgHex },
  })
    .png()
    .toBuffer();
  const printBuf = await sharp(base)
    .composite([{ input: layer, left: destX, top: destY }])
    .jpeg({ quality: 92 })
    .toBuffer();

  const innerBuf = await sharp(printBuf)
    .extract({ left: bleed_px, top: bleed_px, width: inner_w_px, height: inner_h_px })
    .toBuffer();

  const debug = {
    inner_w_px,
    inner_h_px,
    out_w_px,
    out_h_px,
    bleed_px,
    scaleX,
    scaleY,
    scale,
    place: p,
    dest: { x: destX, y: destY },
    targetW,
    targetH,
    clip: { x: clipX, y: clipY, w: clipW, h: clipH },
  };

  return { innerBuf, printBuf, debug };
}

export default composeImage;

