import * as tf from '@tensorflow/tfjs';
import * as nsfw from 'nsfwjs';

let modelPromise: Promise<nsfw.NSFWJS> | null = null;
function getModel() {
  if (!modelPromise) modelPromise = nsfw.load();
  return modelPromise;
}

export async function quickCheckRealNudity(
  imgEl: HTMLImageElement | HTMLCanvasElement
) {
  const model = await getModel();
  const preds = await model.classify(imgEl);
  const map: Record<string, number> = Object.fromEntries(
    preds.map((p) => [p.className.toLowerCase(), p.probability])
  );
  const porn = map.porn || 0,
    sexy = map.sexy || 0,
    hentai = map.hentai || 0,
    drawing = map.drawing || 0;
  return (porn >= 0.8 || sexy >= 0.9) && hentai + drawing < 0.6;
}

