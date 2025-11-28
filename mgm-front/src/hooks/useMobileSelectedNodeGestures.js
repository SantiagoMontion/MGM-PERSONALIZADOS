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

    const disableNodeDrag = () => {
      const node = getSelectedNode?.();
      if (node && typeof node.draggable === 'function') {
        node.draggable(false);
      }
    };

    const preventInteraction = (e) => {
      disableNodeDrag();
      e?.evt?.preventDefault?.();
    };

    stage.on('touchstart', preventInteraction);
    stage.on('touchmove', preventInteraction);
    stage.on('touchend', preventInteraction);
    stage.on('touchcancel', preventInteraction);

    return () => {
      stage.off('touchstart', preventInteraction);
      stage.off('touchmove', preventInteraction);
      stage.off('touchend', preventInteraction);
      stage.off('touchcancel', preventInteraction);

      if (container) {
        container.style.touchAction = prevTouchAction || '';
      }
    };
  }, [stageRef, getSelectedNode]);
}

export default useMobileSelectedNodeGestures;
