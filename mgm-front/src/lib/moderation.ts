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

const HATE_TERMS = [
  'nazi',
  'nazis',
  'nazismo',
  'nazism',
  'nazista',
  'nacionalsocialista',
  'neonazi',
  'neo nazi',
  'neo-nazi',
  'hitler',
  'adolf hitler',
  'adolfhitler',
  'heil hitler',
  'heilhitler',
  'sieg heil',
  'siegheil',
  'swastika',
  'swastica',
  'svastica',
  'svastika',
  'esvastica',
  'esvasticas',
  'esvastika',
  'esvastikas',
  'esvástica',
  'esvásticas',
  'führer',
  'fuhrer',
  'third reich',
  'thirdreich',
  'white power',
  'whitepower',
  'reichsadler',
  'schutzstaffel',
  'hitlerjugend',
];

function normalizeHateCheck(input: string | null | undefined) {
  return (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss');
}

export function quickHateSymbolCheck(nameOrAlt: string | null | undefined) {
  const normalized = normalizeHateCheck(nameOrAlt);
  if (!normalized) return false;
  return HATE_TERMS.some(term => normalized.includes(term));
}

