export interface ImageDimensions {
  imgW: number;
  imgH: number;
  scaleX: number;
  scaleY: number;
}

export function alignCenter({ imgW, imgH, scaleX, scaleY }: ImageDimensions, boardW: number, boardH: number) {
  const w = imgW * scaleX;
  const h = imgH * scaleY;
  return { x: (boardW - w) / 2, y: (boardH - h) / 2 };
}

export function alignLeft({ imgW, scaleX }: ImageDimensions) {
  return { x: 0 };
}

export function alignRight({ imgW, scaleX }: ImageDimensions, boardW: number) {
  const w = imgW * scaleX;
  return { x: boardW - w };
}

export function alignTop({ imgH, scaleY }: ImageDimensions) {
  return { y: 0 };
}

export function alignBottom({ imgH, scaleY }: ImageDimensions, boardH: number) {
  const h = imgH * scaleY;
  return { y: boardH - h };
}
