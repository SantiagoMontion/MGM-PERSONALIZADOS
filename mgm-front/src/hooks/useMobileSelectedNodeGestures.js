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

    // DRAG (mover)
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // PINCH (zoom + rotate)
    let initialDistance = 0;
    let initialAngle = 0;
    let initialScaleX = 1;
    let initialScaleY = 1;
    let initialRotation = 0;

    const MIN_SCALE = 0.3;
    const MAX_SCALE = 4;

    const getTouches = (evt) => evt.touches;

    const isTouchOverNode = (stageInstance, node, clientX, clientY) => {
      const rect = stageInstance.container().getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const shape = stageInstance.getIntersection({ x, y });
      if (!shape) return false;
      return shape === node || (node.isAncestorOf && node.isAncestorOf(shape));
    };

    const handleTouchStart = (e) => {
      const stageInstance = stageRef.current;
      if (!stageInstance) return;

      const node = getSelectedNode?.();
      if (!node) {
        mode = 'none';
        return;
      }

      const touches = getTouches(e.evt);
      const touchCount = touches?.length ?? 0;
      if (!touches || touchCount === 0) return;

      let anyFingerOnNode = false;
      for (let i = 0; i < touchCount; i++) {
        const t = touches[i];
        if (isTouchOverNode(stageInstance, node, t.clientX, t.clientY)) {
          anyFingerOnNode = true;
          break;
        }
      }

      if (anyFingerOnNode) {
        mode = 'dragNode';

        stageInstance.setPointersPositions(e.evt);
        const pointer = stageInstance.getPointerPosition();
        if (!pointer) return;

        dragOffsetX = pointer.x - node.x();
        dragOffsetY = pointer.y - node.y();

        e.evt.preventDefault();
        return;
      }

      if (touchCount === 2) {
        mode = 'pinchNode';

        const [t1, t2] = [touches[0], touches[1]];

        initialDistance = Math.hypot(
          t2.clientX - t1.clientX,
          t2.clientY - t1.clientY,
        );
        if (initialDistance === 0) {
          mode = 'none';
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
        return;
      }

      mode = 'none';
    };

    const handleTouchMove = (e) => {
      const stageInstance = stageRef.current;
      if (!stageInstance) return;

      const node = getSelectedNode?.();
      if (!node) {
        mode = 'none';
        return;
      }

      const touches = getTouches(e.evt);
      const touchCount = touches?.length ?? 0;
      if (!touches || touchCount === 0) return;

      if (mode === 'dragNode') {
        stageInstance.setPointersPositions(e.evt);
        const pointer = stageInstance.getPointerPosition();
        if (!pointer) return;

        node.position({
          x: pointer.x - dragOffsetX,
          y: pointer.y - dragOffsetY,
        });

        node.getLayer()?.batchDraw();
        e.evt.preventDefault();
        return;
      }

      if (mode === 'pinchNode') {
        if (touchCount !== 2) {
          return;
        }

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
      const touches = getTouches(e.evt);
      const touchCount = touches?.length ?? 0;

      if (!touches || touchCount === 0) {
        mode = 'none';
        return;
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
