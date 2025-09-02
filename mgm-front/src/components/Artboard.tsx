import { Group, Rect } from 'react-konva';
import ImageNode from './ImageNode';
import { ImageState } from '@/hooks/useCanvasState';
import type { FitMode } from '@/lib/fitModes';

interface Props {
  width: number;
  height: number;
  image: HTMLImageElement | null;
  imageState: ImageState;
  onChangeImage: (s: ImageState) => void;
  fitMode: FitMode;
  fillColor: string;
  isSelected: boolean;
  onSelectImage: () => void;
  onDeselect: () => void;
  innerRef?: any;
}

export default function Artboard({
  width,
  height,
  image,
  imageState,
  onChangeImage,
  fitMode,
  fillColor,
  isSelected,
  onSelectImage,
  onDeselect,
  innerRef,
}: Props) {
  return (
    <Group
      ref={innerRef}
      x={0}
      y={0}
      // Cuando la imagen no está seleccionada recortamos para ocultar desbordes
      clip={isSelected ? undefined : { x: 0, y: 0, width, height }}
    >
      <Rect
        width={width}
        height={height}
        fill={fitMode === 'contain' ? fillColor : '#fff'}
        onMouseDown={(e) => {
          onDeselect();
          e.cancelBubble = true;
        }}
        onTap={(e) => {
          onDeselect();
          e.cancelBubble = true;
        }}
      />
      <ImageNode
        image={image}
        state={imageState}
        onChange={onChangeImage}
        isSelected={isSelected}
        onSelect={onSelectImage}
      />
    </Group>
  );
}
