import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { resolveIconAsset } from "@/lib/iconRegistry.js";
import { isTouchDevice } from "@/lib/device.ts";
import styles from "./EditorCanvas.module.css";

const EYEDROPPER_ICON_SRC = resolveIconAsset("tintero.svg", {
  fallbackToPublic: false,
});

const PICKER_SCALE = 1;
const PICKER_BASE_WIDTH = 320;
const PICKER_BASE_HEIGHT = 416;
const DEFAULT_COLOR = "#ffffff";

const ensurePrefixedHex = (value) => {
  if (typeof value !== "string") {
    if (value == null) return null;
    value = String(value);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
};

export default function ColorPopover({
  value,
  onChange,
  onChangeComplete,
  open,
  onClose,
  onPickFromCanvas,
  anchorRef,
}) {
  const wrapperRef = useRef(null);
  const contentRef = useRef(null);
  const inputId = useId();
  const [hex, setHex] = useState(value || DEFAULT_COLOR);
  const [iconError, setIconError] = useState(false);
  const [wrapperSize, setWrapperSize] = useState({
    width: PICKER_BASE_WIDTH * PICKER_SCALE,
    height: PICKER_BASE_HEIGHT * PICKER_SCALE,
  });
  const previewFrameRef = useRef(null);
  const latestColorRef = useRef(ensurePrefixedHex(value) || DEFAULT_COLOR);
  const pointerActiveRef = useRef(false);
  const wasOpenRef = useRef(open);
  const isTouch = useMemo(() => isTouchDevice(), []);
  useEffect(() => {
    const normalized = ensurePrefixedHex(value) || DEFAULT_COLOR;
    setHex(normalized);
    latestColorRef.current = normalized;
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const outsideEvent = isTouch ? "pointerdown" : "mousedown";
    const onDown = (e) => {
      if (!wrapperRef.current) return;
      if (
        !wrapperRef.current.contains(e.target) &&
        !(anchorRef?.current && anchorRef.current.contains(e.target))
      ) {
        onClose?.();
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener(outsideEvent, onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener(outsideEvent, onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef, isTouch]);

  useEffect(() => {
    if (open) setIconError(false);
  }, [open]);

  useEffect(
    () => () => {
      if (previewFrameRef.current != null) {
        cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      setWrapperSize({
        width: PICKER_BASE_WIDTH * PICKER_SCALE,
        height: PICKER_BASE_HEIGHT * PICKER_SCALE,
      });
      return;
    }
    const contentEl = contentRef.current;
    if (!contentEl || !wrapperRef.current) return;

    const updateSize = () => {
      const rect = contentEl.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return;
      setWrapperSize((prev) => {
        const width = rect.width;
        const height = rect.height;
        if (
          prev &&
          Math.abs(prev.width - width) < 0.5 &&
          Math.abs(prev.height - height) < 0.5
        ) {
          return prev;
        }
        return { width, height };
      });
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(contentEl);
    window.addEventListener("resize", updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [open]);

  useEffect(() => {
    if (!open || isTouch) return;
    const el = document.getElementById(inputId);
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      if (typeof el.select === "function") {
        el.select();
      }
    });
  }, [open, inputId, isTouch]);

  const previewNextColor = useCallback(
    (nextHex) => {
      const normalized = ensurePrefixedHex(nextHex) || DEFAULT_COLOR;
      setHex(normalized);
      latestColorRef.current = normalized;
      if (!onChange) return;
      if (previewFrameRef.current != null) return;
      previewFrameRef.current = requestAnimationFrame(() => {
        previewFrameRef.current = null;
        onChange(latestColorRef.current);
      });
    },
    [onChange],
  );

  const flushPreview = useCallback(() => {
    if (previewFrameRef.current != null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
      if (onChange) {
        onChange(latestColorRef.current);
      }
    }
    return latestColorRef.current;
  }, [onChange]);

  const emitChangeComplete = useCallback(() => {
    if (!onChangeComplete) return;
    const color = flushPreview();
    if (!color) return;
    onChangeComplete(color);
  }, [flushPreview, onChangeComplete]);

  const handlePickerPointerDown = useCallback(() => {
    pointerActiveRef.current = true;
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerUp = () => {
      if (!pointerActiveRef.current) return;
      pointerActiveRef.current = false;
      emitChangeComplete();
    };
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [open, emitChangeComplete]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      pointerActiveRef.current = false;
      emitChangeComplete();
    }
    wasOpenRef.current = open;
  }, [open, emitChangeComplete]);

  const applyImmediateColor = useCallback(
    (nextHex, { commit = false } = {}) => {
      const normalized = ensurePrefixedHex(nextHex) || DEFAULT_COLOR;
      setHex(normalized);
      latestColorRef.current = normalized;
      if (previewFrameRef.current != null) {
        cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }
      onChange?.(normalized);
      if (commit) {
        onChangeComplete?.(normalized);
      }
    },
    [onChange, onChangeComplete],
  );

  const handlePick = async () => {
    try {
      if (window.EyeDropper) {
        const ed = new window.EyeDropper();
        const { sRGBHex } = await ed.open();
        applyImmediateColor(sRGBHex, { commit: true });
        return;
      }
    } catch {
      // ignore
    }
    onPickFromCanvas?.();
    onClose?.();
  };

  if (!open) return null;

  const showEyedropperIcon = EYEDROPPER_ICON_SRC && !iconError;

  const wrapperStyle = {
    "--picker-scale": PICKER_SCALE,
    width: `${wrapperSize.width}px`,
    height: `${wrapperSize.height}px`,
  };

  return (
    <div
      ref={wrapperRef}
      className={styles.colorPickerWrapper}
      style={wrapperStyle}
    >
      <div ref={contentRef} className={styles.colorPopover}>
        <div className={styles.pickerArea}>
          <HexColorPicker
            color={hex}
            onChange={previewNextColor}
            onPointerDown={handlePickerPointerDown}
            className={styles.colorPicker}
          />
        </div>
        <div className={styles.hexRow}>
          <label className={styles.visuallyHidden} htmlFor={inputId}>
            Hex
          </label>
          <div className={styles.hexInputWrapper}>
            <button
              type="button"
              title="Elegir del lienzo"
              aria-label="Elegir color del lienzo"
              onClick={handlePick}
              className={styles.eyedropperButton}
            >
              {showEyedropperIcon ? (
                <img
                  src={EYEDROPPER_ICON_SRC}
                  alt=""
                  className={styles.eyedropperIcon}
                  onError={() => setIconError(true)}
                  draggable="false"
                />
              ) : (
                <span className={styles.eyedropperFallback} aria-hidden="true" />
              )}
            </button>
            <HexColorInput
              id={inputId}
              color={hex}
              onChange={(c) => {
                const normalized = ensurePrefixedHex(c) || DEFAULT_COLOR;
                previewNextColor(normalized);
              }}
              onBlur={emitChangeComplete}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  emitChangeComplete();
                }
              }}
              prefixed
              className={styles.hexInput}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              inputMode={isTouch ? "none" : undefined}
              readOnly={isTouch}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
