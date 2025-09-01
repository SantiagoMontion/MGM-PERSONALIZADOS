import { forwardRef, useEffect, useRef, useState, useImperativeHandle } from 'react';
import { Stage, Layer, Rect, Group, Image as KonvaImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import styles from './EditorCanvas.module.css';
import { PX_PER_CM } from '@/lib/export-consts';

const CM_PER_INCH = 2.54;
const SCREEN_PX_PER_CM = 10;
const CANVAS_MARGIN_CM = 10;
const MIN_SCALE = 0.05;
const IMG_ZOOM_MAX = 50;

const EditorCanvas = forwardRef(function EditorCanvas(
  { imageUrl, sizeCm = { w: 90, h: 40 }, bleedMm = 3, onLayoutChange },
  ref
) {
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const trRef = useRef(null);
  const [image] = useImage(imageUrl || undefined);

  const bleedCm = bleedMm / 10;
  const workCm = { w: sizeCm.w + bleedCm * 2, h: sizeCm.h + bleedCm * 2 };
  const stageCm = { w: workCm.w + CANVAS_MARGIN_CM * 2, h: workCm.h + CANVAS_MARGIN_CM * 2 };

  const [tx, setTx] = useState({ x_cm: bleedCm, y_cm: bleedCm, scaleX: 1, scaleY: 1, rotation_deg: 0 });

  const [stageZoom, setStageZoom] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  useImperativeHandle(ref, () => ({ getStage: () => stageRef.current }));

  useEffect(() => {
    if (image && trRef.current && imageRef.current) {
      trRef.current.nodes([imageRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [image]);

  // initial cover fit
  useEffect(() => {
    if (!image) return;
    const base = { w: image.naturalWidth / PX_PER_CM, h: image.naturalHeight / PX_PER_CM };
    const scale = Math.max(workCm.w / base.w, workCm.h / base.h);
    const w = base.w * scale;
    const h = base.h * scale;
    setTx({
      x_cm: (workCm.w - w) / 2,
      y_cm: (workCm.h - h) / 2,
      scaleX: scale,
      scaleY: scale,
      rotation_deg: 0,
    });
  }, [image, workCm.w, workCm.h]);

  // notify parent about layout
  useEffect(() => {
    if (!onLayoutChange || !image) return;
    const layout = {
      dpi: Math.round(PX_PER_CM * CM_PER_INCH),
      bleed_mm: bleedMm,
      size_cm: { w: sizeCm.w, h: sizeCm.h },
      image: { natural_px: { w: image.naturalWidth, h: image.naturalHeight } },
      transform: { ...tx, fitMode: 'manual', isManual: true },
      mode: 'manual',
      background: '#ffffff',
      corner_radius_cm: 0,
    };
    onLayoutChange(layout);
  }, [tx, onLayoutChange, image, sizeCm.w, sizeCm.h, bleedMm]);

  // zoom with mouse wheel
  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.05;
    const direction = e.evt.deltaY > 0 ? 1 : -1;
    let newZoom = direction > 0 ? stageZoom / scaleBy : stageZoom * scaleBy;
    newZoom = Math.min(Math.max(newZoom, 0.1), 10);

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / (stageZoom * SCREEN_PX_PER_CM),
      y: (pointer.y - stagePos.y) / (stageZoom * SCREEN_PX_PER_CM),
    };

    const newPos = {
      x: pointer.x - mousePointTo.x * newZoom * SCREEN_PX_PER_CM,
      y: pointer.y - mousePointTo.y * newZoom * SCREEN_PX_PER_CM,
    };

    setStageZoom(newZoom);
    setStagePos(newPos);
  };

  // stage panning
  const startPan = (e) => {
    if (e.target !== stageRef.current) return;
    setIsPanning(true);
    lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
  };

  const panMove = (e) => {
    if (!isPanning) return;
    const pos = { x: e.evt.clientX, y: e.evt.clientY };
    const dx = pos.x - lastPointer.current.x;
    const dy = pos.y - lastPointer.current.y;
    lastPointer.current = pos;
    setStagePos((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  };

  const endPan = () => {
    if (isPanning) setIsPanning(false);
  };

  const handleImageDragEnd = (e) => {
    setTx((prev) => ({
      ...prev,
      x_cm: e.target.x() / (SCREEN_PX_PER_CM * stageZoom) - CANVAS_MARGIN_CM,
      y_cm: e.target.y() / (SCREEN_PX_PER_CM * stageZoom) - CANVAS_MARGIN_CM,
    }));
  };

  const handleTransformEnd = () => {
    const node = imageRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scale({ x: 1, y: 1 });
    const nextScaleX = tx.scaleX * scaleX;
    const nextScaleY = tx.scaleY * scaleY;
    const absX = Math.min(Math.max(Math.abs(nextScaleX), MIN_SCALE), IMG_ZOOM_MAX);
    const absY = Math.min(Math.max(Math.abs(nextScaleY), MIN_SCALE), IMG_ZOOM_MAX);
    setTx({
      x_cm: node.x() / (SCREEN_PX_PER_CM * stageZoom) - CANVAS_MARGIN_CM,
      y_cm: node.y() / (SCREEN_PX_PER_CM * stageZoom) - CANVAS_MARGIN_CM,
      scaleX: Math.sign(nextScaleX) * absX,
      scaleY: Math.sign(nextScaleY) * absY,
      rotation_deg: node.rotation(),
    });
  };

  return (
    <div className={`${styles.canvasWrapper} ${isPanning ? styles.grabbing : ''}`}>
      <Stage
        ref={stageRef}
        width={stageCm.w * SCREEN_PX_PER_CM}
        height={stageCm.h * SCREEN_PX_PER_CM}
        scaleX={stageZoom * SCREEN_PX_PER_CM}
        scaleY={stageZoom * SCREEN_PX_PER_CM}
        x={stagePos.x}
        y={stagePos.y}
        onWheel={handleWheel}
        onMouseDown={startPan}
        onMouseMove={panMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
      >
        <Layer>
          <Rect x={0} y={0} width={stageCm.w} height={stageCm.h} fill="#f3f4f6" />
          <Group clip={{ x: CANVAS_MARGIN_CM, y: CANVAS_MARGIN_CM, width: workCm.w, height: workCm.h }}>
            <Rect x={CANVAS_MARGIN_CM} y={CANVAS_MARGIN_CM} width={workCm.w} height={workCm.h} fill="#fff" />
            {image && (
              <KonvaImage
                ref={imageRef}
                image={image}
                x={tx.x_cm + CANVAS_MARGIN_CM}
                y={tx.y_cm + CANVAS_MARGIN_CM}
                width={image.naturalWidth / PX_PER_CM}
                height={image.naturalHeight / PX_PER_CM}
                scaleX={tx.scaleX}
                scaleY={tx.scaleY}
                rotation={tx.rotation_deg}
                draggable
                onDragEnd={handleImageDragEnd}
                onTransformEnd={handleTransformEnd}
              />
            )}
          </Group>
          <Rect
            x={CANVAS_MARGIN_CM}
            y={CANVAS_MARGIN_CM}
            width={workCm.w}
            height={workCm.h}
            stroke="#d1d5db"
            strokeWidth={0.1}
          />
          <Rect
            x={CANVAS_MARGIN_CM + bleedCm}
            y={CANVAS_MARGIN_CM + bleedCm}
            width={sizeCm.w}
            height={sizeCm.h}
            stroke="#9ca3af"
            dash={[0.5, 0.5]}
            strokeWidth={0.1}
          />
          {image && (
            <Transformer
              ref={trRef}
              rotateEnabled
              keepRatio
              boundBoxFunc={(oldBox, newBox) => {
                const baseW = image.naturalWidth / PX_PER_CM;
                const baseH = image.naturalHeight / PX_PER_CM;
                const maxW = baseW * IMG_ZOOM_MAX;
                const maxH = baseH * IMG_ZOOM_MAX;
                if (
                  newBox.width < baseW * MIN_SCALE ||
                  newBox.height < baseH * MIN_SCALE ||
                  newBox.width > maxW ||
                  newBox.height > maxH
                ) {
                  return oldBox;
                }
                return newBox;
              }}
              onTransformEnd={handleTransformEnd}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
});

export default EditorCanvas;

