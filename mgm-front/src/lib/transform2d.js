export function screenToCanvas(pt, viewPos, scale) {
  return { x: (pt.x - viewPos.x) / scale, y: (pt.y - viewPos.y) / scale };
}

export function canvasToLocal(p, transform) {
  const { tx, ty, theta, sx, sy } = transform;
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);
  const dx = p.x - tx;
  const dy = p.y - ty;
  return {
    x: (dx * cos - dy * sin) / sx,
    y: (dx * sin + dy * cos) / sy,
  };
}

export function localToCanvas(p, transform) {
  const { tx, ty, theta, sx, sy } = transform;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const x = p.x * sx;
  const y = p.y * sy;
  return {
    x: tx + x * cos - y * sin,
    y: ty + x * sin + y * cos,
  };
}

export function composeTransform({ tx, ty, theta, sx, sy }, anchor) {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    a: sx * cos,
    b: sx * sin,
    c: -sy * sin,
    d: sy * cos,
    e: tx + anchor.x - anchor.x * sx * cos + anchor.y * sy * sin,
    f: ty + anchor.y - anchor.x * sx * sin - anchor.y * sy * cos,
  };
}
