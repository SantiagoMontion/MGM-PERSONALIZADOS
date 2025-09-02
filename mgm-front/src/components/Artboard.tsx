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
  innerRef,
}: Props) {
  return (
    <Group ref={innerRef} x={0} y={0} clip={{ x: 0, y: 0, width, height }}>
      <Rect width={width} height={height} fill={fitMode === 'contain' ? fillColor : '#fff'} />
      <ImageNode image={image} state={imageState} onChange={onChangeImage} />
    </Group>
  );
}
