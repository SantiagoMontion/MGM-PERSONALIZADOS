import * as tf from '@tensorflow/tfjs';
import * as nsfw from 'nsfwjs';
import sharp from 'sharp';

let modelPromise;
async function getModel() {
  if (!modelPromise) modelPromise = nsfw.load();
  return modelPromise;
}

async function tensorFromBuffer(buf) {
  const { data, info } = await sharp(buf)
    .removeAlpha()
    .resize(224, 224, { fit: 'cover' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const t = tf
    .tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32')
    .expandDims(0);
  return t;
}

function isRealNudity(preds) {
  const map = Object.fromEntries(
    preds.map((p) => [p.className.toLowerCase(), p.probability])
  );
  const porn = map.porn || 0;
  const sexy = map.sexy || 0;
  const hentai = map.hentai || 0;
  const drawing = map.drawing || 0;
  if ((porn >= 0.85 || sexy >= 0.92) && hentai + drawing < 0.6) return true;
  return false;
}

export async function checkNSFW(buffer) {
  const model = await getModel();
  const t = await tensorFromBuffer(buffer);
  try {
    const preds = await model.classify(t);
    return { preds, block: isRealNudity(preds) };
  } finally {
    t.dispose();
  }
}

