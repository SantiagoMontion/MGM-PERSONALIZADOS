import { forwardRef, useEffect, useRef, useImperativeHandle, useState } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';

import Worktable from './Worktable';
import { useCanvasState } from '@/hooks/useCanvasState';
import { exportArtboard as exportArtboardUtil } from '@/lib/exportArtboard';
import { PX_PER_CM } from '@/lib/export-consts';
import styles from './EditorCanvas.module.css';

const CM_PER_INCH = 2.54;
const SCREEN_PX_PER_CM = 10;
const CANVAS_MARGIN_CM = 10;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

interface Props {
  imageUrl?: string | null;
  sizeCm?: { w: number; h: number };
  bleedMm?: number;
  onLayoutChange?: (layout: any) => void;
}

const EditorCanvas = forwardRef<any, Props>(function EditorCanvas(
  { imageUrl, sizeCm = { w: 90, h: 40 }, bleedMm = 3, onLayoutChange },
  ref
) {
  const stageRef = useRef<Konva.Stage>(null);
  const worktableRef = useRef<Konva.Group>(null);
  const { stage, image, updateStage, updateImage, restored } = useCanvasState();
  const [img] = useImage(imageUrl || undefined);
  const [isPanning, setIsPanning] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);

  const bleedCm = bleedMm / 10;
  const workCm = { w: sizeCm.w + bleedCm * 2, h: sizeCm.h + bleedCm * 2 };
  const marginPx = CANVAS_MARGIN_CM * SCREEN_PX_PER_CM;
  const workPx = { w: workCm.w * SCREEN_PX_PER_CM, h: workCm.h * SCREEN_PX_PER_CM };
  const stagePx = { w: workPx.w + marginPx * 2, h: workPx.h + marginPx * 2 };

  useImperativeHandle(
    ref,
    () => ({
      getStage: () => stageRef.current,
      exportArtboard: (opts: { scale?: number; mime?: string; quality?: number } = {}) => {
        if (!stageRef.current) return null;
        const ratio = PX_PER_CM / SCREEN_PX_PER_CM;
        return exportArtboardUtil(stageRef.current, {
          x: marginPx,
          y: marginPx,
          width: workPx.w,
          height: workPx.h,
          pixelRatio: ratio,
          ...opts,
        });
      },
    }),
    [marginPx, workPx.w, workPx.h]
  );

  // fit image initially if no saved state
  useEffect(() => {
    if (!img) return;
    if (initialized.current) return;
    if (restored && (image.x !== 0 || image.y !== 0 || image.scale !== 1 || image.rotation !== 0)) {
      initialized.current = true;
      return;
    }
    const baseW = (img.naturalWidth / PX_PER_CM) * SCREEN_PX_PER_CM;
    const baseH = (img.naturalHeight / PX_PER_CM) * SCREEN_PX_PER_CM;
    const scale = Math.max(workPx.w / baseW, workPx.h / baseH);
    const w = baseW * scale;
    const h = baseH * scale;
    updateImage({
      x: (workPx.w - w) / 2,
      y: (workPx.h - h) / 2,
      scale,
      rotation: 0,
    });
    initialized.current = true;
  }, [img, workPx.w, workPx.h, restored, image, updateImage]);

  // notify parent about layout
  useEffect(() => {
    if (!img || !onLayoutChange) return;
    const layout = {
      dpi: Math.round(PX_PER_CM * CM_PER_INCH),
      bleed_mm: bleedMm,
      size_cm: { w: sizeCm.w, h: sizeCm.h },
      image: { natural_px: { w: img.naturalWidth, h: img.naturalHeight } },
      transform: {
        x_cm: image.x / SCREEN_PX_PER_CM - bleedCm,
        y_cm: image.y / SCREEN_PX_PER_CM - bleedCm,
        scaleX: image.scale,
        scaleY: image.scale,
        rotation_deg: image.rotation,
        fitMode: 'manual',
        isManual: true,
      },
      mode: 'manual',
      background: '#ffffff',
      corner_radius_cm: 0,
    };
    onLayoutChange(layout);
  }, [img, image, onLayoutChange, sizeCm.w, sizeCm.h, bleedMm, bleedCm]);

  // zoom centered on pointer
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stageObj = stageRef.current;
    if (!stageObj) return;
    const oldScale = stage.scale;
    const pointer = stageObj.getPointerPosition();
    if (!pointer) return;
    const delta = -e.evt.deltaY / 500; // normalize
    let newScale = oldScale * (1 + delta);
    newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
    const mousePointTo = {
      x: (pointer.x - stage.x) / oldScale,
      y: (pointer.y - stage.y) / oldScale,
    };
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    updateStage({ scale: newScale, x: newPos.x, y: newPos.y });
  };

  // panning
  const handleMouseDown = (e: any) => {
    if (e.target !== stageRef.current) return;
    setIsPanning(true);
    const pos = stageRef.current?.getPointerPosition();
    if (pos) lastPos.current = pos;
  };
  const handleMouseMove = (e: any) => {
    if (!isPanning) return;
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    const dx = pos.x - lastPos.current.x;
    const dy = pos.y - lastPos.current.y;
    lastPos.current = pos;
    updateStage({ ...stage, x: stage.x + dx, y: stage.y + dy });
  };
  const endPan = () => setIsPanning(false);

  const handleAdjust = () => {
    updateStage({ scale: 1, x: 0, y: 0 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "0") { e.preventDefault(); handleAdjust(); }
      if (e.ctrlKey && e.key === "1") { e.preventDefault(); updateStage({ ...stage, scale: 1 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage]);

  return (
    <div className={styles.canvasWrapper + (isPanning ? ' ' + styles.grabbing : '')}>
      <button className={styles.undoButton} onClick={handleAdjust}>Ajustar a pantalla</button>
      <Stage
        ref={stageRef}
        width={stagePx.w}
        height={stagePx.h}
        scaleX={stage.scale}
        scaleY={stage.scale}
        x={stage.x}
        y={stage.y}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
      >
        <Layer>
          <Rect x={0} y={0} width={stagePx.w} height={stagePx.h} fill="#f3f4f6" />
          <Worktable
            innerRef={worktableRef}
            image={img}
            sizePx={workPx}
            imageState={image}
            onChange={updateImage}
          />
          <Rect
            x={marginPx}
            y={marginPx}
            width={workPx.w}
            height={workPx.h}
            stroke="#d1d5db"
            strokeWidth={0.1}
          />
        </Layer>
      </Stage>
    </div>
  );
});

export default EditorCanvas;

