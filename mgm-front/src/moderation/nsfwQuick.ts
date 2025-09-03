// Carga perezosa para evitar SSR issues
let _model: any = null;

export async function loadNSFW() {
  if (_model) return _model;
  const nsfwjs = await import('nsfwjs');
  await import('@tensorflow/tfjs'); // tfjs 3.x
  _model = await nsfwjs.load();     // modelo por defecto hosteado gratis
  return _model;
}

export type QuickCheck = { allow: boolean; reason?: string; scores?: Record<string, number> };

export async function quickExplicitCheck(imgEl: HTMLImageElement | HTMLCanvasElement): Promise<QuickCheck> {
  const model = await loadNSFW();
  const preds = await model.classify(imgEl as any);
  const scores: Record<string, number> = {};
  preds.forEach((p: any) => scores[p.className] = p.probability);

  const drawing = (scores['Drawing'] ?? 0) + (scores['Hentai'] ?? 0);
  const sexual  = (scores['Porn'] ?? 0) + (scores['Sexy'] ?? 0);

  // Anime/dibujo SIEMPRE permitido
  if (drawing >= 0.60) return { allow: true, scores };

  // Si parece sexual y NO es dibujo, pedimos chequeo final en servidor (no bloquear aquí)
  const thr = Number((typeof process !== 'undefined' && (process as any).env?.NUDE_REAL_THRESHOLD) || 0.75);
  if (sexual >= thr) {
    return { allow: true, reason: 'server_check_required', scores };
  }

  return { allow: true, scores };
}
