import { useEffect, useRef, useState } from 'react';
import useImage from 'use-image';
import { createInitialState } from '@/lib/canvas/state';
import { beginResize, updateResize } from '@/lib/canvas/interaction';
import { zoomAt, panBy } from '@/lib/canvas/zoom';
import { invert, multiply, scaling, translation, rotation, apply } from '@/lib/canvas/matrix';
import styles from './EditorCanvas.module.css';

const MIN_HANDLE_PX = 8;

function EditorCanvas({ imageUrl, sizeCm }) {
  const canvasRef = useRef(null);
  const [img] = useImage(imageUrl);
  const [state, setState] = useState(() => createInitialState(100, 100));
  const stateRef = useRef(state);
  const frameRef = useRef(0);
  const resizeRef = useRef(null);
  const panRef = useRef(null);

  useEffect(() => {
    stateRef.current = state;
    draw();
  }, [state, img]);

  useEffect(() => {
    if (img) {
      const s = createInitialState(img.width, img.height);
      s.pad = { w: img.width, h: img.height, radius: 0 };
      setState(s);
    }
  }, [img]);

  const requestRender = () => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setState({ ...stateRef.current });
    });
  };

  const domToWorld = (evt) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const V = multiply(
      translation(stateRef.current.camera.panX, stateRef.current.camera.panY),
      scaling(stateRef.current.camera.zoom, stateRef.current.camera.zoom)
    );
    const Vinv = invert(V);
    return apply(Vinv, x, y);
  };

  const getHandle = (world) => {
    const { w0, h0 } = stateRef.current.image;
    const N = multiply(
      translation(stateRef.current.node.x, stateRef.current.node.y),
      multiply(rotation(stateRef.current.node.rotation), scaling(stateRef.current.node.scaleX, stateRef.current.node.scaleY))
    );
    const handles = {
      nw: apply(N, -w0 / 2, -h0 / 2),
      ne: apply(N, w0 / 2, -h0 / 2),
      se: apply(N, w0 / 2, h0 / 2),
      sw: apply(N, -w0 / 2, h0 / 2),
    };
    const zoom = stateRef.current.camera.zoom;
    let chosen = null;
    let dist = Infinity;
    for (const key in handles) {
      const h = handles[key];
      const dx = (h.x - world.x) * zoom;
      const dy = (h.y - world.y) * zoom;
      const d = Math.hypot(dx, dy);
      if (d < MIN_HANDLE_PX && d < dist) {
        chosen = key;
        dist = d;
      }
    }
    return chosen;
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    const world = domToWorld(e);
    const handle = getHandle(world);
    if (handle) {
      resizeRef.current = beginResize(stateRef.current, handle, world, e.altKey);
      e.target.setPointerCapture(e.pointerId);
    } else {
      panRef.current = { x: e.clientX, y: e.clientY };
      e.target.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e) => {
    if (resizeRef.current) {
      const world = domToWorld(e);
      updateResize(stateRef.current, resizeRef.current, world, e.shiftKey);
      requestRender();
    } else if (panRef.current) {
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      panRef.current.x = e.clientX;
      panRef.current.y = e.clientY;
      panBy(stateRef.current, dx, dy);
      requestRender();
    }
  };

  const onPointerUp = (e) => {
    if (resizeRef.current) {
      resizeRef.current = null;
    }
    if (panRef.current) {
      panRef.current = null;
    }
    e.target.releasePointerCapture(e.pointerId);
    requestRender();
  };

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    zoomAt(
      stateRef.current,
      delta,
      e.clientX - canvasRef.current.getBoundingClientRect().left,
      e.clientY - canvasRef.current.getBoundingClientRect().top
    );
    requestRender();
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const { camera, node, image } = stateRef.current;
    const V = multiply(translation(camera.panX, camera.panY), scaling(camera.zoom, camera.zoom));
    ctx.save();
    ctx.transform(V[0], V[1], V[2], V[3], V[4], V[5]);
    const N = multiply(
      translation(node.x, node.y),
      multiply(rotation(node.rotation), scaling(node.scaleX, node.scaleY))
    );
    ctx.save();
    ctx.transform(N[0], N[1], N[2], N[3], N[4], N[5]);
    if (img) {
      ctx.drawImage(img, -image.w0 / 2, -image.h0 / 2, image.w0, image.h0);
    } else {
      ctx.fillStyle = '#ccc';
      ctx.fillRect(-image.w0 / 2, -image.h0 / 2, image.w0, image.h0);
    }
    ctx.restore();
    const corners = [
      apply(N, -image.w0 / 2, -image.h0 / 2),
      apply(N, image.w0 / 2, -image.h0 / 2),
      apply(N, image.w0 / 2, image.h0 / 2),
      apply(N, -image.w0 / 2, image.h0 / 2),
    ];
    ctx.strokeStyle = '#0099ff';
    ctx.lineWidth = 1 / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    corners.forEach((p) => {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#0099ff';
      const s = 6 / camera.zoom;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
    });
    ctx.restore();
  };

  return (
    <div className={styles.canvasWrapper}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}

export default EditorCanvas;
