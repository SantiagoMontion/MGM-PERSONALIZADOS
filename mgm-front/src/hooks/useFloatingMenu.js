import { useEffect, useState } from 'react';

const GAP = 8;
const ESTIMATED_MENU_HEIGHT = 3 * 48 + 16 + 2;
const MIN_VIEWPORT_PADDING = 8;
const MIN_MENU_HEIGHT = 140;

export function useFloatingMenu(triggerRef, isOpen) {
  const [style, setStyle] = useState({});

  useEffect(() => {
    if (!isOpen) {
      setStyle({});
      return undefined;
    }

    function positionMenu() {
      const triggerEl = triggerRef.current;
      if (!triggerEl) return;
      const rect = triggerEl.getBoundingClientRect();
      const width = Math.round(rect.width);

      let left = rect.left;
      let top = rect.bottom + GAP;

      let menuHeight = ESTIMATED_MENU_HEIGHT;
      const controlsId = triggerEl.getAttribute('aria-controls');
      if (controlsId) {
        const menuEl = document.getElementById(controlsId);
        if (menuEl) {
          menuHeight = menuEl.offsetHeight || menuHeight;
        }
      }

      const availableBelow = Math.max(0, window.innerHeight - rect.bottom - GAP - MIN_VIEWPORT_PADDING);
      const availableAbove = Math.max(0, rect.top - GAP - MIN_VIEWPORT_PADDING);
      const shouldOpenBelow = availableBelow >= menuHeight || availableBelow >= availableAbove;

      let maxHeight = shouldOpenBelow ? availableBelow : availableAbove;
      if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
        maxHeight = window.innerHeight - MIN_VIEWPORT_PADDING * 2;
      }

      if (shouldOpenBelow) {
        top = rect.bottom + GAP;
      } else {
        const visibleHeight = Math.min(menuHeight, maxHeight);
        top = Math.max(MIN_VIEWPORT_PADDING, rect.top - GAP - visibleHeight);
      }

      const maxLeft = window.innerWidth - width - MIN_VIEWPORT_PADDING;
      left = Math.max(MIN_VIEWPORT_PADDING, Math.min(left, maxLeft));

      setStyle({
        position: 'fixed',
        top,
        left,
        width,
        minWidth: width,
        maxHeight: Math.max(MIN_MENU_HEIGHT, Math.floor(maxHeight)),
      });
    }

    positionMenu();
    const raf = requestAnimationFrame(positionMenu);
    const handleScroll = () => positionMenu();
    const handleResize = () => positionMenu();

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [triggerRef, isOpen]);

  return style;
}
