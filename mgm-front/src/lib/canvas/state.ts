export type Camera = {
  zoom: number;
  panX: number;
  panY: number;
};

export type NodeTransform = {
  x: number;
  y: number;
  rotation: number; // radians
  scaleX: number;
  scaleY: number;
};

export interface CanvasState {
  camera: Camera;
  node: NodeTransform;
  image: { w0: number; h0: number };
  pad: { w: number; h: number; radius: number };
  mode: 'cover' | 'contain' | 'stretch';
}

export const createInitialState = (w0: number, h0: number): CanvasState => ({
  camera: { zoom: 1, panX: 0, panY: 0 },
  node: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  image: { w0, h0 },
  pad: { w: w0, h: h0, radius: 0 },
  mode: 'contain',
});
