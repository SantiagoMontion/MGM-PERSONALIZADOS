import { Mat2D, apply } from './matrix';

export type BBox = { x: number; y: number; w: number; h: number };

export const localBBox = (w0: number, h0: number): BBox => ({
  x: -w0 / 2,
  y: -h0 / 2,
  w: w0,
  h: h0,
});

export const bboxFromMatrix = (m: Mat2D, w0: number, h0: number): BBox => {
  const corners = [
    apply(m, -w0 / 2, -h0 / 2),
    apply(m, w0 / 2, -h0 / 2),
    apply(m, w0 / 2, h0 / 2),
    apply(m, -w0 / 2, h0 / 2),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};
