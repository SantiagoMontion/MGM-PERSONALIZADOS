export type Mat2D = [number, number, number, number, number, number];

export const identity = (): Mat2D => [1, 0, 0, 1, 0, 0];

export const multiply = (a: Mat2D, b: Mat2D): Mat2D => {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
};

export const translation = (tx: number, ty: number): Mat2D => [1, 0, 0, 1, tx, ty];

export const scaling = (sx: number, sy: number): Mat2D => [sx, 0, 0, sy, 0, 0];

export const rotation = (rad: number): Mat2D => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
};

export const invert = (m: Mat2D): Mat2D => {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) return identity();
  const inv = 1 / det;
  return [
    m[3] * inv,
    -m[1] * inv,
    -m[2] * inv,
    m[0] * inv,
    (m[2] * m[5] - m[3] * m[4]) * inv,
    (m[1] * m[4] - m[0] * m[5]) * inv,
  ];
};

export const apply = (m: Mat2D, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});
