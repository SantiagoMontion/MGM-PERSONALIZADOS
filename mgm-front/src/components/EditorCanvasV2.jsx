import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva';
import useImage from 'use-image';
import { camera as cameraMatrix, compose as composeMatrix, multiplyAll, localToWorld, worldToLocal } from '@/lib/matrix2d';

const MIN_SCALE = 0.05;
const MAX_SCALE = 50;

const DEBUG = import.meta.env.VITE_CANVAS_DEBUG === '1';

const EditorCanvasV2 = forwardRef(function EditorCanvasV2({ imageUrl }, ref) {
  const [img] = useImage(imageUrl);
  const wrapRef = useRef(null);
  const stageRef = useRef(null);

  const [wrapSize, setWrapSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setWrapSize({ w: r.width, h: r.height });
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const [camera, setCamera] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [node, setNode] = useState({ x: wrapSize.w / 2, y: wrapSize.h / 2, scaleX: 1, scaleY: 1, rotation: 0 });
  useEffect(() => {
    setNode((n) => ({ ...n, x: wrapSize.w / 2, y: wrapSize.h / 2 }));
  }, [wrapSize.w, wrapSize.h, img]);

  const [freeScale, setFreeScale] = useState(false);
  const stateRef = useRef({ phase: 'idle', camera, node });
  const rafRef = useRef(0);

  useImperativeHandle(ref, () => ({ camera, node }));

  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const s = stateRef.current;
      setCamera({ ...s.camera });
      setNode({ ...s.node });
    });
  };

  const pointerDom = (evt) => {
    const stage = stageRef.current;
    const rect = stage.container().getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };

  const handlePointerDown = (evt, mode, handle) => {
    evt.preventDefault();
    const container = stageRef.current.container();
    try { container.setPointerCapture(evt.pointerId); } catch {}

    const cam = { ...camera };
    const nd = { ...node };
    const natural = { w: img?.width || 0, h: img?.height || 0 };
    const V0 = cameraMatrix(cam);
    const N0 = composeMatrix(nd);
    const VN0 = multiplyAll(V0, N0);
    const dom = pointerDom(evt);
    const pointerWorld = worldToLocal(dom, V0);

    let pivotLocal = { x: 0, y: 0 };
    let handleVec = { x: natural.w, y: natural.h };
    if (mode === 'resize' && handle) {
      const halfW = natural.w / 2;
      const halfH = natural.h / 2;
      const map = {
        tl: { pivot: { x: halfW, y: halfH }, vec: { x: -natural.w, y: -natural.h } },
        tr: { pivot: { x: -halfW, y: halfH }, vec: { x: natural.w, y: -natural.h } },
        bl: { pivot: { x: halfW, y: -halfH }, vec: { x: -natural.w, y: natural.h } },
        br: { pivot: { x: -halfW, y: -halfH }, vec: { x: natural.w, y: natural.h } },
      };
      pivotLocal = map[handle].pivot;
      handleVec = map[handle].vec;
    }

    const pivotWorldBefore = localToWorld(pivotLocal, VN0);
    stateRef.current = {
      phase: 'pressing',
      mode,
      handleVec,
      pointerDom0: dom,
      pointerWorldPrev: pointerWorld,
      camera: cam,
      camera0: cam,
      node: nd,
      natural,
      V0,
      pivotLocal,
      pivotWorldBefore,
    };
  };

  const onPointerDownNode = (e) => handlePointerDown(e.evt, 'move');
  const onPointerDownHandle = (name) => (e) => handlePointerDown(e.evt, 'resize', name);

  const handlePointerMove = (evt) => {
    const s = stateRef.current;
    if (s.phase === 'idle') return;
    evt.preventDefault();
    const dom = pointerDom(evt);
    if (s.phase === 'pressing') {
      const dx = dom.x - s.pointerDom0.x;
      const dy = dom.y - s.pointerDom0.y;
      if (dx * dx + dy * dy < 9) return;
      s.phase = 'dragging';
    }
    const pointerWorld = worldToLocal(dom, s.V0);
    if (s.mode === 'move') {
      const delta = { x: pointerWorld.x - s.pointerWorldPrev.x, y: pointerWorld.y - s.pointerWorldPrev.y };
      s.node.x += delta.x;
      s.node.y += delta.y;
      s.pointerWorldPrev = pointerWorld;
    } else if (s.mode === 'resize') {
      const pointerLocal = worldToLocal(pointerWorld, multiplyAll(s.V0, composeMatrix(s.node)));
      let sx = (pointerLocal.x - s.pivotLocal.x) / s.handleVec.x;
      let sy = (pointerLocal.y - s.pivotLocal.y) / s.handleVec.y;
      if (!freeScale) {
        const k = Math.sign(sx) * Math.min(Math.abs(sx), Math.abs(sy));
        sx = sy = k;
      }
      sx = Math.min(MAX_SCALE, Math.max(MIN_SCALE, sx));
      sy = Math.min(MAX_SCALE, Math.max(MIN_SCALE, sy));
      const nextNode = { ...s.node, scaleX: sx, scaleY: sy };
      const N = composeMatrix(nextNode);
      const pivotWorldAfter = localToWorld(s.pivotLocal, multiplyAll(s.V0, N));
      nextNode.x += s.pivotWorldBefore.x - pivotWorldAfter.x;
      nextNode.y += s.pivotWorldBefore.y - pivotWorldAfter.y;
      s.node = nextNode;
    } else if (s.mode === 'pan') {
      s.camera.panX = s.camera0.panX + (dom.x - s.pointerDom0.x);
      s.camera.panY = s.camera0.panY + (dom.y - s.pointerDom0.y);
    }
    schedule();
  };

  const handlePointerUp = (evt) => {
    const container = stageRef.current.container();
    try { container.releasePointerCapture(evt.pointerId); } catch {}
    stateRef.current.phase = 'idle';
  };

  const onWheel = (e) => {
    e.preventDefault();
    const dom = pointerDom(e);
    const world = worldToLocal(dom, cameraMatrix(camera));
    const dir = e.deltaY > 0 ? 1 / 1.1 : 1.1;
    const zoom = Math.min(12, Math.max(0.3, camera.zoom * dir));
    const cam = { ...camera, zoom };
    const V = cameraMatrix(cam);
    const domAfter = localToWorld(world, V);
    cam.panX += dom.x - domAfter.x;
    cam.panY += dom.y - domAfter.y;
    stateRef.current.camera = cam;
    stateRef.current.node = { ...node };
    schedule();
  };

  const onPointerDownStage = (evt) => {
    if (evt.button === 1 || evt.button === 2) {
      handlePointerDown(evt, 'pan');
    }
  };

  useEffect(() => {
    const container = stageRef.current.container();
    container.addEventListener('pointerdown', onPointerDownStage);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('pointerdown', onPointerDownStage);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('wheel', onWheel);
    };
  }, [handlePointerMove]);

  const halfW = img ? img.width / 2 : 0;
  const halfH = img ? img.height / 2 : 0;

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Stage
        width={wrapSize.w}
        height={wrapSize.h}
        ref={stageRef}
        x={camera.panX}
        y={camera.panY}
        scaleX={camera.zoom}
        scaleY={camera.zoom}
      >
        <Layer>
          {img && (
            <KonvaImage
              image={img}
              x={node.x}
              y={node.y}
              scaleX={node.scaleX}
              scaleY={node.scaleY}
              rotation={node.rotation}
              offsetX={halfW}
              offsetY={halfH}
              onPointerDown={onPointerDownNode}
            />
          )}
          {img && ['tl', 'tr', 'bl', 'br'].map(name => {
            const pos = {
              tl: { x: -halfW, y: -halfH },
              tr: { x: halfW, y: -halfH },
              bl: { x: -halfW, y: halfH },
              br: { x: halfW, y: halfH },
            }[name];
            return (
              <Rect
                key={name}
                x={node.x + pos.x * node.scaleX}
                y={node.y + pos.y * node.scaleY}
                width={10}
                height={10}
                offsetX={5}
                offsetY={5}
                fill="white"
                stroke="black"
                strokeWidth={1 / camera.zoom}
                onPointerDown={onPointerDownHandle(name)}
              />
            );
          })}
        </Layer>
      </Stage>
      <label style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(255,255,255,0.8)' }}>
        <input type="checkbox" checked={freeScale} onChange={e => setFreeScale(e.target.checked)} /> Escalar libre
      </label>
      {DEBUG && (() => {
        const dbg = `x:${node.x.toFixed(2)} y:${node.y.toFixed(2)} sx:${node.scaleX.toFixed(2)} sy:${node.scaleY.toFixed(2)} rot:${node.rotation.toFixed(2)}`;
        return <div style={{ position: 'absolute', top: 40, left: 10, background: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{dbg}</div>;
      })()}
    </div>
  );
});

export default EditorCanvasV2;
