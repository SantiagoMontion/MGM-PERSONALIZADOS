export function compose({ x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1 }) {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return { a: c * scaleX, b: s * scaleX, c: -s * scaleY, d: c * scaleY, e: x, f: y };
}

export function camera({ panX = 0, panY = 0, zoom = 1 }) {
  return { a: zoom, b: 0, c: 0, d: zoom, e: panX, f: panY };
}

export function multiply(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function invert(m) {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return null;
  const inv = 1 / det;
  return {
    a:  m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d:  m.a * inv,
    e: (m.c * m.f - m.d * m.e) * inv,
    f: (m.b * m.e - m.a * m.f) * inv,
  };
}

export function apply(m, p) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export const localToWorld = (p, m) => apply(m, p);
export const worldToLocal = (p, m) => {
  const inv = invert(m);
  return inv ? apply(inv, p) : { ...p };
};

export const multiplyAll = (...ms) => ms.reduce((acc, m) => multiply(acc, m));
