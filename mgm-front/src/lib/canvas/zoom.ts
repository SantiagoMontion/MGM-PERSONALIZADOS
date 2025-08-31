import { CanvasState } from './state';
import { apply, invert, multiply, scaling, translation } from './matrix';

export const zoomAt = (
  state: CanvasState,
  dz: number,
  anchorX: number,
  anchorY: number
) => {
  const nextZoom = Math.min(Math.max(state.camera.zoom * dz, 0.1), 10);
  const V = multiply(translation(state.camera.panX, state.camera.panY), scaling(state.camera.zoom, state.camera.zoom));
  const Vinv = invert(V);
  const worldPt = apply(Vinv, anchorX, anchorY);
  state.camera.zoom = nextZoom;
  const V2 = multiply(translation(state.camera.panX, state.camera.panY), scaling(state.camera.zoom, state.camera.zoom));
  const screenPt = apply(V2, worldPt.x, worldPt.y);
  state.camera.panX += anchorX - screenPt.x;
  state.camera.panY += anchorY - screenPt.y;
};

export const panBy = (state: CanvasState, dx: number, dy: number) => {
  state.camera.panX += dx;
  state.camera.panY += dy;
};
