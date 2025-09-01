import { useEffect, useRef, useState } from 'react';

export interface StageState {
  scale: number;
  x: number;
  y: number;
}

export interface ImageState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

interface CanvasState {
  stage: StageState;
  image: ImageState;
}

const DEFAULT_STATE: CanvasState = {
  stage: { scale: 1, x: 0, y: 0 },
  image: { x: 0, y: 0, scale: 1, rotation: 0 },
};

/**
 * React hook to persist stage and image state in localStorage.
 * Values are debounced to avoid excessive writes.
 */
export function useCanvasState(storageKey = 'editorCanvasState') {
  const [stage, setStage] = useState<StageState>(DEFAULT_STATE.stage);
  const [image, setImage] = useState<ImageState>(DEFAULT_STATE.image);
  const [restored, setRestored] = useState(false);
  const stateRef = useRef<CanvasState>(DEFAULT_STATE);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // restore on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CanvasState;
        if (parsed.stage && parsed.image) {
          setStage(parsed.stage);
          setImage(parsed.image);
          stateRef.current = parsed;
        }
      }
    } catch {
      // ignore corrupted storage
    }
    setRestored(true);
  }, [storageKey]);

  const persist = (next: Partial<CanvasState>) => {
    stateRef.current = { ...stateRef.current, ...next } as CanvasState;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(stateRef.current));
      } catch {
        // ignore
      }
    }, 200);
  };

  const updateStage = (next: StageState) => {
    setStage(next);
    persist({ stage: next });
  };

  const updateImage = (next: ImageState) => {
    setImage(next);
    persist({ image: next });
  };

  return { stage, image, updateStage, updateImage, restored };
}

