import { forwardRef, useEffect, useRef, useState, useImperativeHandle } from 'react';
import { Stage, Layer, Rect, Image as KonvaImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import styles from './EditorCanvas.module.css';
import { PX_PER_CM } from '@/lib/export-consts';

const CM_PER_INCH = 2.54;
const SCREEN_PX_PER_CM = 10;
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

  const [tx, setTx] = useState({ x_cm: bleedCm, y_cm: bleedCm, scaleX: 1, scaleY: 1, rotation_deg: 0 });

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
    setTx({ x_cm: (workCm.w - w) / 2, y_cm: (workCm.h - h) / 2, scaleX: scale, scaleY: scale, rotation_deg: 0 });
  }, [image, workCm.w, workCm.h]);

  // notify parent
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

  const boundPosition = (pos) => {
    if (!image) return pos;
    const w = (image.naturalWidth / PX_PER_CM) * tx.scaleX;
    const h = (image.naturalHeight / PX_PER_CM) * tx.scaleY;
    const minX = 0;
    const minY = 0;
    const maxX = workCm.w - w;
    const maxY = workCm.h - h;
    return {
      x: Math.min(Math.max(pos.x, minX), maxX),
      y: Math.min(Math.max(pos.y, minY), maxY),
    };
  };

  const handleTransformEnd = () => {
    const node = imageRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scale({ x: 1, y: 1 });
    const pos = boundPosition({ x: node.x() / SCREEN_PX_PER_CM, y: node.y() / SCREEN_PX_PER_CM });
    const nextScaleX = tx.scaleX * scaleX;
    const nextScaleY = tx.scaleY * scaleY;
    const signX = Math.sign(nextScaleX) || 1;
    const signY = Math.sign(nextScaleY) || 1;
    const absX = Math.min(Math.max(Math.abs(nextScaleX), MIN_SCALE), IMG_ZOOM_MAX);
    const absY = Math.min(Math.max(Math.abs(nextScaleY), MIN_SCALE), IMG_ZOOM_MAX);
    setTx({
      x_cm: pos.x,
      y_cm: pos.y,
      scaleX: signX * absX,
      scaleY: signY * absY,
      rotation_deg: node.rotation(),
    });
  };

  return (
    <div className={styles.canvasWrapper}>
      <Stage
        ref={stageRef}
        width={workCm.w * SCREEN_PX_PER_CM}
        height={workCm.h * SCREEN_PX_PER_CM}
        scaleX={SCREEN_PX_PER_CM}
        scaleY={SCREEN_PX_PER_CM}
      >
        <Layer>
          <Rect x={0} y={0} width={workCm.w} height={workCm.h} stroke="#ef4444" />
          {image && (
            <>
              <KonvaImage
                ref={imageRef}
                image={image}
                x={tx.x_cm}
                y={tx.y_cm}
                width={image.naturalWidth / PX_PER_CM}
                height={image.naturalHeight / PX_PER_CM}
                scaleX={tx.scaleX}
                scaleY={tx.scaleY}
                rotation={tx.rotation_deg}
                draggable
                dragBoundFunc={(pos) => {
                  const bounded = boundPosition({ x: pos.x / SCREEN_PX_PER_CM, y: pos.y / SCREEN_PX_PER_CM });
                  return { x: bounded.x * SCREEN_PX_PER_CM, y: bounded.y * SCREEN_PX_PER_CM };
                }}
                onDragEnd={(e) => {
                  const bounded = boundPosition({ x: e.target.x() / SCREEN_PX_PER_CM, y: e.target.y() / SCREEN_PX_PER_CM });
                  setTx((prev) => ({ ...prev, x_cm: bounded.x, y_cm: bounded.y }));
                }}
                onTransformEnd={handleTransformEnd}
              />
              <Transformer
                ref={trRef}
                rotateEnabled
                keepRatio
                boundBoxFunc={(oldBox, newBox) => {
                  const w = newBox.width;
                  const h = newBox.height;
                  const baseW = image.naturalWidth / PX_PER_CM;
                  const baseH = image.naturalHeight / PX_PER_CM;
                  const maxW = baseW * IMG_ZOOM_MAX;
                  const maxH = baseH * IMG_ZOOM_MAX;
                  if (w < baseW * MIN_SCALE || h < baseH * MIN_SCALE || w > maxW || h > maxH) {
                    return oldBox;
                  }
                  return newBox;
                }}
                onTransformEnd={handleTransformEnd}
              />
            </>
          )}
        </Layer>
      </Stage>
    </div>
  );
});

export default EditorCanvas;

