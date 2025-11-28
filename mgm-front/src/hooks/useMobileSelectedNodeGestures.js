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

    // PINCH (zoom + rotate)
    let initialDistance = 0;
    let initialAngle = 0;
    let initialScaleX = 1;
    let initialScaleY = 1;
    let initialRotation = 0;

    const resetPinchState = () => {
      initialDistance = 0;
      initialAngle = 0;
      initialScaleX = 1;
      initialScaleY = 1;
      initialRotation = 0;
    };

    const MIN_SCALE = 0.3;
    const MAX_SCALE = 4;

    const getTouches = (evt) => evt.touches;

    const enableNodeDrag = () => {
      const node = getSelectedNode?.();
      if (node && typeof node.draggable === 'function') {
        node.draggable(true);
      }
    };

    const handleTouchStart = (e) => {
      const touches = getTouches(e.evt);
      if (!touches || touches.length !== 2) {
        resetPinchState();
        enableNodeDrag();
        return;
      }

      const node = getSelectedNode?.();
      if (!node) return;

      const [t1, t2] = [touches[0], touches[1]];

      if (typeof node.draggable === 'function') {
        node.draggable(false);
      }

      initialDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );
      if (initialDistance === 0) {
        return;
      }

      initialAngle = Math.atan2(
        t2.clientY - t1.clientY,
        t2.clientX - t1.clientX,
      );

      initialScaleX = node.scaleX();
      initialScaleY = node.scaleY();
      initialRotation = node.rotation();

      e.evt.preventDefault();
    };

    const handleTouchMove = (e) => {
      const touches = getTouches(e.evt);
      if (!touches || touches.length !== 2) {
        resetPinchState();
        enableNodeDrag();
        return;
      }

      const node = getSelectedNode?.();
      if (!node) return;

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
    };

    const handleTouchEnd = (e) => {
      const touches = getTouches(e.evt);
      const touchCount = touches?.length ?? 0;

      if (touchCount < 2) {
        resetPinchState();
        enableNodeDrag();
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
