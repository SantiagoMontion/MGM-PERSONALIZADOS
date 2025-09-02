export type FitMode = 'contain' | 'cover' | 'stretch' | 'manual';

export interface FitResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitContain(imgW: number, imgH: number, boardW: number, boardH: number): FitResult {
  const scale = Math.min(boardW / imgW, boardH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  const x = (boardW - width) / 2;
  const y = (boardH - height) / 2;
  return { x, y, width, height };
}

export function fitCover(imgW: number, imgH: number, boardW: number, boardH: number): FitResult {
  const scale = Math.max(boardW / imgW, boardH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  const x = (boardW - width) / 2;
  const y = (boardH - height) / 2;
  return { x, y, width, height };
}

export function fitStretch(imgW: number, imgH: number, boardW: number, boardH: number): FitResult {
  return { x: 0, y: 0, width: boardW, height: boardH };
}
