export type FitMode = 'contain' | 'cover' | 'stretch' | 'manual';

export interface FitResult {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

export function fitContain(imgW: number, imgH: number, boardW: number, boardH: number): FitResult {
  const scale = Math.min(boardW / imgW, boardH / imgH);
  const x = (boardW - imgW * scale) / 2;
  const y = (boardH - imgH * scale) / 2;
  return { x, y, scaleX: scale, scaleY: scale };
}

export function fitCover(imgW: number, imgH: number, boardW: number, boardH: number): FitResult {
  const scale = Math.max(boardW / imgW, boardH / imgH);
  const x = (boardW - imgW * scale) / 2;
  const y = (boardH - imgH * scale) / 2;
  return { x, y, scaleX: scale, scaleY: scale };
}

export function fitStretch(imgW: number, imgH: number, boardW: number, boardH: number): FitResult {
  const scaleX = boardW / imgW;
  const scaleY = boardH / imgH;
  return { x: 0, y: 0, scaleX, scaleY };
}
