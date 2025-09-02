import { useEffect, useRef, useState } from 'react';
import { STORAGE_KEY } from '@/lib/constants';
import type { FitMode } from '@/lib/fitModes';

export interface StageState {
  scale: number;
  x: number;
  y: number;
}

export interface ImageState {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  src?: string;
}

interface CanvasState {
  stage: StageState;
  image: ImageState;
  fitMode: FitMode;
  fillColor: string;
  selected: boolean;
}

const DEFAULT_STATE: CanvasState = {
  stage: { scale: 1, x: 0, y: 0 },
  image: { x: 0, y: 0, width: 0, height: 0, rotation: 0, src: '' },
  fitMode: 'manual',
  fillColor: '#ffffff',
  selected: false,
};

/**
 * Persist editor state in localStorage with debounce.
 */
export function useCanvasState(storageKey: string = STORAGE_KEY) {
  const [stage, setStage] = useState<StageState>(DEFAULT_STATE.stage);
  const [image, setImage] = useState<ImageState>(DEFAULT_STATE.image);
  const [fitMode, setFitMode] = useState<FitMode>(DEFAULT_STATE.fitMode);
  const [fillColor, setFillColor] = useState<string>(DEFAULT_STATE.fillColor);
  const [selected, setSelected] = useState<boolean>(DEFAULT_STATE.selected);
  const [restored, setRestored] = useState(false);
  const stateRef = useRef<CanvasState>(DEFAULT_STATE);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // restore
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CanvasState;
        if (parsed.stage && parsed.image) {
          setStage(parsed.stage);
          setImage(parsed.image);
          setFitMode(parsed.fitMode || 'manual');
          setFillColor(parsed.fillColor || '#ffffff');
          setSelected(parsed.selected || false);
          stateRef.current = {
            stage: parsed.stage,
            image: parsed.image,
            fitMode: parsed.fitMode || 'manual',
            fillColor: parsed.fillColor || '#ffffff',
            selected: parsed.selected || false,
          };
        }
      }
    } catch {
      // ignore invalid storage
    }
    setRestored(true);
  }, [storageKey]);

  const persist = () => {
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
    stateRef.current.stage = next;
    persist();
  };

  const updateImage = (next: ImageState) => {
    setImage(next);
    stateRef.current.image = next;
    persist();
  };

  const updateFitMode = (mode: FitMode) => {
    setFitMode(mode);
    stateRef.current.fitMode = mode;
    persist();
  };

  const updateFillColor = (color: string) => {
    setFillColor(color);
    stateRef.current.fillColor = color;
    persist();
  };

  const updateSelected = (s: boolean) => {
    setSelected(s);
    stateRef.current.selected = s;
    persist();
  };

  return {
    stage,
    image,
    fitMode,
    fillColor,
    updateStage,
    updateImage,
    updateFitMode,
    updateFillColor,
    selected,
    updateSelected,
    restored,
  };
}
