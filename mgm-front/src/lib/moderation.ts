// Lazy client-side moderation to keep tfjs/nsfwjs out of the API build
export async function quickNsfwCheck(imgEl: HTMLImageElement | HTMLCanvasElement) {
  const nsfwjs: any = await import('nsfwjs');
  await import('@tensorflow/tfjs');
  const model = await nsfwjs.load();
  const preds = await model.classify(imgEl);
  const pornish = preds.some((p: any) => (p.className === 'Porn' || p.className === 'Hentai') && p.probability >= 0.75);
  const sexy = preds.some((p: any) => p.className === 'Sexy' && p.probability >= 0.85);
  return pornish || sexy;
}

export function quickHateSymbolCheck(nameOrAlt: string | null | undefined) {
  const s = (nameOrAlt || '').toLowerCase();
  return /(\bnazi\b|\bswastika\b|\bhitler\b)/.test(s);
}

