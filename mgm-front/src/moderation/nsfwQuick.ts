import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

let _model: nsfwjs.NSFWJS|null = null;
export async function loadNSFW() {
  if (_model) return _model;
  // modelo por defecto de nsfwjs (hosteado). Si prefieres local, descarga y sirve el modelo.
  _model = await nsfwjs.load();
  return _model!;
}

export type QuickCheck = { allow: boolean; reason?: string; scores?: Record<string, number> };

export async function quickExplicitCheck(imgEl: HTMLImageElement | HTMLCanvasElement): Promise<QuickCheck> {
  const model = await loadNSFW();
  const preds = await model.classify(imgEl as any);
  const scores: Record<string, number> = {};
  preds.forEach(p => scores[p.className] = p.probability);

  const drawing = (scores['Drawing'] ?? 0) + (scores['Hentai'] ?? 0);
  const sexual = (scores['Porn'] ?? 0) + (scores['Sexy'] ?? 0);

  // Regla rápida:
  // - Si es claramente dibujo/anime -> permitir
  if (drawing >= 0.60) return { allow: true, scores };

  // - Si parece sexual explícito pero no sabemos si es real, marcar para chequeo server
  if (sexual >= 0.60) return { allow: true, reason: 'server_check_required', scores };

  // En otros casos, permitir
  return { allow: true, scores };
}
