import { CanvasState } from './state';
import { apply, invert, multiply, rotation, scaling, translation, Mat2D } from './matrix';

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ResizeSession {
  handle: Handle;
  pivotLocal: { x: number; y: number };
  pivotWorld: { x: number; y: number };
  worldToLocal: Mat2D;
  localToWorld: Mat2D;
}

const handlePivot = (handle: Handle, w0: number, h0: number) => {
  const w2 = w0 / 2;
  const h2 = h0 / 2;
  switch (handle) {
    case 'nw': return { x: w2, y: h2 };
    case 'ne': return { x: -w2, y: h2 };
    case 'se': return { x: -w2, y: -h2 };
    case 'sw': return { x: w2, y: -h2 };
    case 'n': return { x: 0, y: h2 };
    case 's': return { x: 0, y: -h2 };
    case 'e': return { x: -w2, y: 0 };
    case 'w': return { x: w2, y: 0 };
  }
};

export const beginResize = (
  state: CanvasState,
  handle: Handle,
  worldPoint: { x: number; y: number },
  altKey: boolean
): ResizeSession => {
  const { w0, h0 } = state.image;
  const N = multiply(
    translation(state.node.x, state.node.y),
    multiply(rotation(state.node.rotation), scaling(state.node.scaleX, state.node.scaleY))
  );
  const Ninv = invert(N);  const pivotLocal = altKey ? { x: 0, y: 0 } : handlePivot(handle, w0, h0);
  const pivotWorld = apply(N, pivotLocal.x, pivotLocal.y);
  return {
    handle,
    pivotLocal,
    pivotWorld,
    worldToLocal: Ninv,
    localToWorld: N,
  };
};

export const updateResize = (
  state: CanvasState,
  session: ResizeSession,
  worldPoint: { x: number; y: number },
  shiftKey: boolean
) => {
  const { w0, h0 } = state.image;
  const local = apply(session.worldToLocal, worldPoint.x, worldPoint.y);
  const pivot = session.pivotLocal;
  const baseX = session.handle.includes('e')
    ? w0 / 2
    : session.handle.includes('w')
    ? -w0 / 2
    : pivot.x;
  const baseY = session.handle.includes('s')
    ? h0 / 2
    : session.handle.includes('n')
    ? -h0 / 2
    : pivot.y;
  let sx = state.node.scaleX;
  let sy = state.node.scaleY;
  if (baseX !== pivot.x) {
    sx = (local.x - pivot.x) / (baseX - pivot.x);
  }
  if (baseY !== pivot.y) {
    sy = (local.y - pivot.y) / (baseY - pivot.y);
  }
  if (shiftKey) {
    const k = Math.min(sx, sy);
    sx = sy = k;
  }
  state.node.scaleX = sx;
  state.node.scaleY = sy;
  const N = multiply(
    translation(state.node.x, state.node.y),
    multiply(rotation(state.node.rotation), scaling(state.node.scaleX, state.node.scaleY))
  );
  const worldPivot = apply(N, pivot.x, pivot.y);
  state.node.x += session.pivotWorld.x - worldPivot.x;
  state.node.y += session.pivotWorld.y - worldPivot.y;
};
