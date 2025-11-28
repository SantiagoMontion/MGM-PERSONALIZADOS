import { useEffect } from 'react';
import { isTouchDevice } from '@/lib/device.ts';

export function useMobileSelectedNodeGestures(stageRef, getSelectedNode) {
  useEffect(() => {
    if (!isTouchDevice()) return undefined;

    const stage = stageRef?.current;
    if (!stage || typeof stage.on !== 'function') return undefined;

    const container = stage.container();
    const prevTouchAction = container?.style?.touchAction;
    if (container) {
      container.style.touchAction = 'none';
    }

    /** @type {'none' | 'dragNode' | 'pinchNode'} */
    let mode = 'none';

    // DRAG (1 dedo)
    let dragStartX = 0;
    let dragStartY = 0;
    let nodeStartX = 0;
    let nodeStartY = 0;

    // PINCH (2 dedos)
    let initialDistance = 0;
    let initialAngle = 0;
    let initialScaleX = 1;
    let initialScaleY = 1;
    let initialRotation = 0;

    const MIN_SCALE = 0.3;
    const MAX_SCALE = 4;

    const getTouches = (evt) => evt.touches;

    const handleTouchStart = (e) => {
      const stage = stageRef.current;
      if (!stage) return;

      const node = getSelectedNode?.();
      if (!node) {
        mode = 'none';
        return;
      }

      const touches = getTouches(e.evt);
      if (!touches || touches.length === 0) return;

      // --- 2 dedos → PINCH (zoom + rotación, sin mover) ---
      if (touches.length === 2) {
        mode = 'pinchNode';

        const [t1, t2] = [touches[0], touches[1]];
        initialDistance = Math.hypot(
          t2.clientX - t1.clientX,
          t2.clientY - t1.clientY,
        );
        if (initialDistance === 0) return;

        initialAngle = Math.atan2(
          t2.clientY - t1.clientY,
          t2.clientX - t1.clientX,
        );

        initialScaleX = node.scaleX();
        initialScaleY = node.scaleY();
        initialRotation = node.rotation();

        e.evt.preventDefault();
        return;
      }

      // --- 1 dedo → posible DRAG si toca la imagen ---
      if (touches.length === 1) {
        const touch = touches[0];
        const rect = stage.container().getBoundingClientRect();

        const pointerX = touch.clientX - rect.left;
        const pointerY = touch.clientY - rect.top;

        const shape = stage.getIntersection({ x: pointerX, y: pointerY });

        if (
          shape &&
          (shape === node || (typeof node.isAncestorOf === 'function' && node.isAncestorOf(shape)))
        ) {
          mode = 'dragNode';

          dragStartX = pointerX;
          dragStartY = pointerY;
          nodeStartX = node.x();
          nodeStartY = node.y();

          e.evt.preventDefault();
        } else {
          mode = 'none';
        }
      }
    };

    const handleTouchMove = (e) => {
      const stage = stageRef.current;
      if (!stage) return;

      const node = getSelectedNode?.();
      if (!node) {
        mode = 'none';
        return;
      }

      const touches = getTouches(e.evt);
      if (!touches || touches.length === 0) return;

      // --- DRAG: 1 dedo, solo mover, sin escalar ni rotar ---
      if (mode === 'dragNode' && touches.length === 1) {
        const touch = touches[0];
        const rect = stage.container().getBoundingClientRect();

        const currentX = touch.clientX - rect.left;
        const currentY = touch.clientY - rect.top;

        const dx = currentX - dragStartX;
        const dy = currentY - dragStartY;

        node.position({
          x: nodeStartX + dx,
          y: nodeStartY + dy,
        });

        node.getLayer()?.batchDraw();
        e.evt.preventDefault();
        return;
      }

      // --- PINCH: 2 dedos, SOLO escala + rotación, NO mover ---
      if (mode === 'pinchNode' && touches.length === 2) {
        const [t1, t2] = [touches[0], touches[1]];

        const currentDistance = Math.hypot(
          t2.clientX - t1.clientX,
          t2.clientY - t1.clientY,
        );
        if (currentDistance <= 0 || initialDistance <= 0) return;

        let scaleFactor = currentDistance / initialDistance;

        let newScaleX = initialScaleX * scaleFactor;
        let newScaleY = initialScaleY * scaleFactor;

        if (newScaleX < MIN_SCALE) newScaleX = MIN_SCALE;
        if (newScaleY < MIN_SCALE) newScaleY = MIN_SCALE;
        if (newScaleX > MAX_SCALE) newScaleX = MAX_SCALE;
        if (newScaleY > MAX_SCALE) newScaleY = MAX_SCALE;

        node.scaleX(newScaleX);
        node.scaleY(newScaleY);

        const currentAngle = Math.atan2(
          t2.clientY - t1.clientY,
          t2.clientX - t1.clientX,
        );
        const deltaAngleRad = currentAngle - initialAngle;
        const deltaAngleDeg = (deltaAngleRad * 180) / Math.PI;

        node.rotation(initialRotation + deltaAngleDeg);

        node.getLayer()?.batchDraw();
        e.evt.preventDefault();
        return;
      }
    };

    const handleTouchEnd = (e) => {
      const stage = stageRef.current;
      if (!stage) return;

      const touches = getTouches(e.evt);

      if (!touches || touches.length === 0) {
        mode = 'none';
        return;
      }

      if (mode === 'pinchNode' && touches.length === 1) {
        const node = getSelectedNode?.();
        if (!node) {
          mode = 'none';
          return;
        }

        const touch = touches[0];
        const rect = stage.container().getBoundingClientRect();
        const pointerX = touch.clientX - rect.left;
        const pointerY = touch.clientY - rect.top;

        const shape = stage.getIntersection({ x: pointerX, y: pointerY });

        if (
          shape &&
          (shape === node || (typeof node.isAncestorOf === 'function' && node.isAncestorOf(shape)))
        ) {
          mode = 'dragNode';
          dragStartX = pointerX;
          dragStartY = pointerY;
          nodeStartX = node.x();
          nodeStartY = node.y();
        } else {
          mode = 'none';
        }
      } else if (touches.length === 1 && mode === 'dragNode') {
        return;
      } else {
        mode = 'none';
      }
    };

    stage.on('touchstart', handleTouchStart);
    stage.on('touchmove', handleTouchMove);
    stage.on('touchend', handleTouchEnd);
    stage.on('touchcancel', handleTouchEnd);

    return () => {
      stage.off('touchstart', handleTouchStart);
      stage.off('touchmove', handleTouchMove);
      stage.off('touchend', handleTouchEnd);
      stage.off('touchcancel', handleTouchEnd);

      if (container) {
        container.style.touchAction = prevTouchAction || '';
      }
    };
  }, [stageRef, getSelectedNode]);
}

export default useMobileSelectedNodeGestures;
