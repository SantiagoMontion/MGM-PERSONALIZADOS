import { Group, Rect, Image as KonvaImage, Transformer } from 'react-konva';
import { useEffect, useRef } from 'react';
import type Konva from 'konva';

interface WorktableProps {
  image: HTMLImageElement | null;
  sizePx: { w: number; h: number };
  imageState: { x: number; y: number; scale: number; rotation: number };
  onChange: (state: { x: number; y: number; scale: number; rotation: number }) => void;
  innerRef: React.RefObject<Konva.Group>;
}

export default function Worktable({ image, sizePx, imageState, onChange, innerRef }: WorktableProps) {
  const imageRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (image && trRef.current && imageRef.current) {
      trRef.current.nodes([imageRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [image]);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Save absolute position without stage scale compensation to avoid
    // jump-back when dropping.
    onChange({ ...imageState, x: e.target.x(), y: e.target.y() });
  };

  const handleTransformEnd = () => {
    const node = imageRef.current;
    if (!node) return;
    const scale = node.scaleX();
    const rotation = node.rotation();
    node.scaleX(1);
    node.scaleY(1);
    onChange({
      x: node.x(),
      y: node.y(),
      scale: imageState.scale * scale,
      rotation,
    });
  };

  return (
    <Group
      ref={innerRef}
      x={0}
      y={0}
      clip={{ x: 0, y: 0, width: sizePx.w, height: sizePx.h }}
    >
      <Rect width={sizePx.w} height={sizePx.h} fill="#fff" />
      {image && (
        <KonvaImage
          ref={imageRef}
          image={image}
          x={imageState.x}
          y={imageState.y}
          scaleX={imageState.scale}
          scaleY={imageState.scale}
          rotation={imageState.rotation}
          draggable
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      )}
      {image && <Transformer ref={trRef} rotateEnabled keepRatio />}
    </Group>
  );
}

