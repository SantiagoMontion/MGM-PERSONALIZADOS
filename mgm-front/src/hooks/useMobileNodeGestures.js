import { useEffect } from 'react';

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export function useMobileNodeGestures({ stageRef, getSelectedNode, enabled }) {
  useEffect(() => {
    if (!enabled) return undefined;

    const stage = stageRef?.current;
    if (!stage || typeof stage.on !== 'function') return undefined;

    const container = stage.container();
    const prevTouchAction = container?.style?.touchAction;
    if (container) {
      container.style.touchAction = 'none';
    }

    let isNodeGesture = false;
    let initialDistance = 0;
    let initialAngle = 0;
    let initialScaleX = 1;
    let initialScaleY = 1;
    let initialRotation = 0;

    const MIN_SCALE = 0.3;
    const MAX_SCALE = 4;

    const getTouches = (evt) => evt.touches;

    const handleTouchStart = (e) => {
      const node = getSelectedNode?.();
      const touches = getTouches(e.evt);

      if (!node || !touches || touches.length !== 2) return;

      e.evt.preventDefault();

      isNodeGesture = true;

      const [t1, t2] = [touches[0], touches[1]];
      initialDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (initialDistance === 0) return;

      initialAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
      initialScaleX = node.scaleX();
      initialScaleY = node.scaleY();
      initialRotation = node.rotation();
    };

    const handleTouchMove = (e) => {
      if (!isNodeGesture) return;

      const node = getSelectedNode?.();
      const touches = getTouches(e.evt);

      if (!node || !touches || touches.length !== 2) return;

      e.evt.preventDefault();

      const [t1, t2] = [touches[0], touches[1]];
      const currentDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (currentDistance <= 0 || initialDistance <= 0) return;

      const scaleFactor = currentDistance / initialDistance;
      const newScaleX = clamp(initialScaleX * scaleFactor, MIN_SCALE, MAX_SCALE);
      const newScaleY = clamp(initialScaleY * scaleFactor, MIN_SCALE, MAX_SCALE);

      node.scaleX(newScaleX);
      node.scaleY(newScaleY);

      const currentAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
      const deltaAngleRad = currentAngle - initialAngle;
      const deltaAngleDeg = (deltaAngleRad * 180) / Math.PI;

      node.rotation(initialRotation + deltaAngleDeg);
      node.getLayer()?.batchDraw();
    };

    const handleTouchEnd = (e) => {
      const touches = getTouches(e.evt);
      if (!touches || touches.length < 2) {
        isNodeGesture = false;
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
  }, [stageRef, getSelectedNode, enabled]);
}

export default useMobileNodeGestures;
