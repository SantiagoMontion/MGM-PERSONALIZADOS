import { useEffect, useRef } from 'react';
import { Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { ImageState } from '@/hooks/useCanvasState';

interface Props {
  image: HTMLImageElement | null;
  state: ImageState;
  onChange: (s: ImageState) => void;
  isSelected: boolean;
  onSelect: () => void;
}

export default function ImageNode({ image, state, onChange, isSelected, onSelect }: Props) {
  const imageRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (image && trRef.current && imageRef.current && isSelected) {
      trRef.current.nodes([imageRef.current]);
      trRef.current.getLayer()?.batchDraw();
    } else if (trRef.current) {
      trRef.current.nodes([]);
    }
  }, [image, isSelected]);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange({ ...state, x: e.target.x(), y: e.target.y() });
  };

  const handleTransformEnd = () => {
    const node = imageRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const rotation = node.rotation();
    // scale se aplica al width/height para evitar el "salto" visual al soltar
    const width = Math.max(1, node.width() * scaleX);
    const height = Math.max(1, node.height() * scaleY);
    node.scaleX(1);
    node.scaleY(1);
    node.width(width);
    node.height(height);
    onChange({
      ...state,
      x: node.x(),
      y: node.y(),
      width,
      height,
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
        width={state.width || image.naturalWidth}
        height={state.height || image.naturalHeight}
        rotation={state.rotation}
        draggable={isSelected}
        onClick={(e) => { onSelect(); e.cancelBubble = true; }}
        onTap={(e) => { onSelect(); e.cancelBubble = true; }}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
        name="image-node"
      />
      {isSelected && <Transformer ref={trRef} keepRatio rotateEnabled />}
    </>
  );
}
