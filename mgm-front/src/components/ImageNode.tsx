import { useEffect, useRef } from 'react';
import { Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { ImageState } from '@/hooks/useCanvasState';

interface Props {
  image: HTMLImageElement | null;
  state: ImageState;
  onChange: (s: ImageState) => void;
}

export default function ImageNode({ image, state, onChange }: Props) {
  const imageRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (image && trRef.current && imageRef.current) {
      trRef.current.nodes([imageRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [image]);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange({ ...state, x: e.target.x(), y: e.target.y() });
  };

  const handleTransformEnd = () => {
    const node = imageRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const rotation = node.rotation();
    node.scaleX(1);
    node.scaleY(1);
    onChange({
      ...state,
      x: node.x(),
      y: node.y(),
      scaleX: state.scaleX * scaleX,
      scaleY: state.scaleY * scaleY,
      rotation,
    });
  };

  if (!image) return null;

  return (
    <>
      <KonvaImage
        ref={imageRef}
        image={image}
        x={state.x}
        y={state.y}
        scaleX={state.scaleX}
        scaleY={state.scaleY}
        rotation={state.rotation}
        draggable
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      />
      <Transformer ref={trRef} keepRatio rotateEnabled />
    </>
  );
}
