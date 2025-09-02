import { forwardRef, useEffect, useRef, useImperativeHandle, useState } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';

import Artboard from './Artboard';
import { useCanvasState } from '@/hooks/useCanvasState';
import { exportArtboard as exportArtboardUtil } from '@/lib/exportArtboard';
import { PX_PER_CM } from '@/lib/export-consts';
import { MIN_ZOOM, MAX_ZOOM, VIEW_MARGIN } from '@/lib/constants';
import { fitContain, fitCover, fitStretch, FitMode } from '@/lib/fitModes';
import { alignCenter, alignLeft, alignRight, alignTop, alignBottom } from '@/lib/alignHelpers';
import styles from './EditorCanvas.module.css';

const SCREEN_PX_PER_CM = 10;

interface Props {
  imageUrl?: string | null;
  sizeCm?: { w: number; h: number };
  bleedMm?: number;
}

const EditorCanvas = forwardRef<any, Props>(function EditorCanvas(
  { imageUrl, sizeCm = { w: 90, h: 40 }, bleedMm = 3 },
  ref
) {
  const stageRef = useRef<Konva.Stage>(null);
  const {
    stage,
    image,
    fitMode,
    fillColor,
    selected,
    updateStage,
    updateImage,
    updateFitMode,
    updateFillColor,
    updateSelected,
    restored,
  } = useCanvasState();
  const [img] = useImage(image.src || imageUrl || undefined);
  const [isPanning, setIsPanning] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const spacePressed = useRef(false);
  const initialized = useRef(false);

  const bleedCm = bleedMm / 10;
  const workCm = { w: sizeCm.w + bleedCm * 2, h: sizeCm.h + bleedCm * 2 };
  const workPx = { w: workCm.w * SCREEN_PX_PER_CM, h: workCm.h * SCREEN_PX_PER_CM };
  const stagePx = { w: workPx.w + VIEW_MARGIN * 2, h: workPx.h + VIEW_MARGIN * 2 };

  // expose export function
  useImperativeHandle(
    ref,
    () => ({
      getStage: () => stageRef.current,
      exportArtboard: (opts: { scale?: number; mime?: string; quality?: number; backgroundColor?: string } = {}) => {
        if (!stageRef.current) return null;
        const ratio = PX_PER_CM / SCREEN_PX_PER_CM;
        return exportArtboardUtil(stageRef.current, {
          x: VIEW_MARGIN,
          y: VIEW_MARGIN,
          width: workPx.w,
          height: workPx.h,
          pixelRatio: ratio,
          backgroundColor: opts.backgroundColor,
          scale: opts.scale,
          mime: opts.mime,
          quality: opts.quality,
        });
      },
    }),
    [workPx.w, workPx.h]
  );

  // keep src in state for persistence
  useEffect(() => {
    if (imageUrl && imageUrl !== image.src) {
      updateImage({ ...image, src: imageUrl });
    }
  }, [imageUrl]);

  // initial fit once
  // In versiones previas un useEffect recalculaba el ajuste en cada render y
  // la imagen "volvía" a su preset. Con `initialized` nos aseguramos de que
  // el ajuste automático se ejecute solo una vez al montar.
  useEffect(() => {
    if (!img || initialized.current) return;
    if (image.width === 0 && image.height === 0) {
      const r = fitContain(img.naturalWidth, img.naturalHeight, workPx.w, workPx.h);
      updateImage({ ...image, ...r, rotation: 0, src: image.src || imageUrl || '' });
      updateFitMode('contain');
    }
    initialized.current = true;
  }, [img, restored]);

  // zoom with wheel
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stageObj = stageRef.current;
    if (!stageObj) return;
    const pointer = stageObj.getPointerPosition();
    if (!pointer) return;
    const scaleBy = 1.05;
    let newScale = stage.scale * (e.evt.deltaY > 0 ? 1 / scaleBy : scaleBy);
    newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
    const mousePointTo = {
      x: (pointer.x - stage.x) / stage.scale,
      y: (pointer.y - stage.y) / stage.scale,
    };
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    updateStage({ scale: newScale, x: newPos.x, y: newPos.y });
  };

  // panning with space+drag
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spacePressed.current = true; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spacePressed.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const handleMouseDown = (e: any) => {
    if (spacePressed.current) {
      setIsPanning(true);
      const pos = stageRef.current?.getPointerPosition();
      if (pos) lastPos.current = pos;
      return;
    }
    if (e.target === stageRef.current || e.target.name() === 'stage-bg') {
      updateSelected(false);
    }
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

  // view helpers
  const zoomBy = (factor: number) => {
    const center = { x: stagePx.w / 2, y: stagePx.h / 2 };
    const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, stage.scale * factor));
    const mousePointTo = {
      x: (center.x - stage.x) / stage.scale,
      y: (center.y - stage.y) / stage.scale,
    };
    const newPos = {
      x: center.x - mousePointTo.x * newScale,
      y: center.y - mousePointTo.y * newScale,
    };
    updateStage({ scale: newScale, x: newPos.x, y: newPos.y });
  };

  const handleAdjustView = () => {
    const scale = Math.min(stagePx.w / workPx.w, stagePx.h / workPx.h);
    const x = (stagePx.w - workPx.w * scale) / 2;
    const y = (stagePx.h - workPx.h * scale) / 2;
    updateStage({ scale, x, y });
  };

  const handleResetImage = () => {
    if (!img) return;
    const r = fitContain(img.naturalWidth, img.naturalHeight, workPx.w, workPx.h);
    updateImage({ ...image, ...r, rotation: 0 });
    updateFitMode('contain');
  };

  // fit modes
  const applyFit = (mode: FitMode) => {
    if (!img) return;
    let r;
    if (mode === 'contain') r = fitContain(img.naturalWidth, img.naturalHeight, workPx.w, workPx.h);
    else if (mode === 'cover') r = fitCover(img.naturalWidth, img.naturalHeight, workPx.w, workPx.h);
    else r = fitStretch(img.naturalWidth, img.naturalHeight, workPx.w, workPx.h);
    updateImage({ ...image, ...r });
    updateFitMode(mode);
  };

  // alignments
  const handleAlign = (type: string) => {
    if (!img) return;
    const dims = { width: image.width, height: image.height };
    if (type === 'center') updateImage({ ...image, ...alignCenter(dims, workPx.w, workPx.h) });
    if (type === 'left') updateImage({ ...image, ...alignLeft() });
    if (type === 'right') updateImage({ ...image, ...alignRight(dims, workPx.w) });
    if (type === 'top') updateImage({ ...image, ...alignTop() });
    if (type === 'bottom') updateImage({ ...image, ...alignBottom(dims, workPx.h) });
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomBy(1.1); }
      if (e.ctrlKey && e.key === '-') { e.preventDefault(); zoomBy(1/1.1); }
      if (e.ctrlKey && e.key === '0') { e.preventDefault(); handleAdjustView(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); updateImage({ ...image, y: image.y - (e.shiftKey ? 10 : 1) }); }
      if (e.key === 'ArrowDown') { e.preventDefault(); updateImage({ ...image, y: image.y + (e.shiftKey ? 10 : 1) }); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); updateImage({ ...image, x: image.x - (e.shiftKey ? 10 : 1) }); }
      if (e.key === 'ArrowRight') { e.preventDefault(); updateImage({ ...image, x: image.x + (e.shiftKey ? 10 : 1) }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [image, stage]);

  return (
    <>
      <div className={styles.toolbar} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <span>Alineación:</span>
        <button onClick={() => handleAlign('center')}>Centro</button>
        <button onClick={() => handleAlign('left')}>Izquierda</button>
        <button onClick={() => handleAlign('right')}>Derecha</button>
        <button onClick={() => handleAlign('top')}>Arriba</button>
        <button onClick={() => handleAlign('bottom')}>Abajo</button>
        <span>Ajuste:</span>
        <button onClick={() => applyFit('contain')}>Contain</button>
        <button onClick={() => applyFit('cover')}>Cover</button>
        <button onClick={() => applyFit('stretch')}>Stretch</button>
        {fitMode === 'contain' && (
          <input type="color" value={fillColor} onChange={(e) => updateFillColor(e.target.value)} />
        )}
        <span>Vista:</span>
        <button onClick={() => zoomBy(1.1)}>+Zoom</button>
        <button onClick={() => zoomBy(1 / 1.1)}>-Zoom</button>
        <button onClick={handleAdjustView}>Ajustar a pantalla</button>
        <button onClick={handleResetImage}>Reset imagen</button>
      </div>
      <div className={styles.canvasWrapper + (isPanning ? ' ' + styles.grabbing : '')}>
        <button className={styles.undoButton} onClick={handleAdjustView}>Ajustar a pantalla</button>
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
            <Rect name="stage-bg" x={0} y={0} width={stagePx.w} height={stagePx.h} fill="#f3f4f6" />
            <Artboard
              width={workPx.w}
              height={workPx.h}
              image={img}
              imageState={image}
              onChangeImage={updateImage}
              fitMode={fitMode}
              fillColor={fillColor}
              isSelected={selected}
              onSelectImage={() => updateSelected(true)}
              onDeselect={() => updateSelected(false)}
            />
            <Rect
              x={VIEW_MARGIN}
              y={VIEW_MARGIN}
              width={workPx.w}
              height={workPx.h}
              stroke="#d1d5db"
              strokeWidth={0.1}
            />
          </Layer>
        </Stage>
      </div>
    </>
  );
});

export default EditorCanvas;
