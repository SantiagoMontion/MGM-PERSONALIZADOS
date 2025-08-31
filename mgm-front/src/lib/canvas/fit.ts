import { CanvasState } from './state';

export const fitContain = (s: CanvasState) => {
  const sx = s.pad.w / s.image.w0;
  const sy = s.pad.h / s.image.h0;
  const k = Math.min(sx, sy);
  s.node.scaleX = s.node.scaleY = k;
  s.node.x = 0;
  s.node.y = 0;
};

export const fitCover = (s: CanvasState) => {
  const sx = s.pad.w / s.image.w0;
  const sy = s.pad.h / s.image.h0;
  const k = Math.max(sx, sy);
  s.node.scaleX = s.node.scaleY = k;
  s.node.x = 0;
  s.node.y = 0;
};

export const fitStretch = (s: CanvasState) => {
  s.node.scaleX = s.pad.w / s.image.w0;
  s.node.scaleY = s.pad.h / s.image.h0;
  s.node.x = 0;
  s.node.y = 0;
};
