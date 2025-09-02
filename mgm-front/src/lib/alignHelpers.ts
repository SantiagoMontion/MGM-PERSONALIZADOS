export interface ImageDimensions {
  width: number;
  height: number;
}

export function alignCenter({ width, height }: ImageDimensions, boardW: number, boardH: number) {
  return { x: (boardW - width) / 2, y: (boardH - height) / 2 };
}

export function alignLeft() {
  return { x: 0 };
}

export function alignRight({ width }: ImageDimensions, boardW: number) {
  return { x: boardW - width };
}

export function alignTop() {
  return { y: 0 };
}

export function alignBottom({ height }: ImageDimensions, boardH: number) {
  return { y: boardH - height };
}
