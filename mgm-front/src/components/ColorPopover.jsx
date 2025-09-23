import { useEffect, useId, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { resolveIconAsset } from "@/lib/iconRegistry.js";
import styles from "./EditorCanvas.module.css";

const EYEDROPPER_ICON_SRC = resolveIconAsset("tintero.svg", {
  fallbackToPublic: false,
});

const PICKER_SCALE = 0.5;
const PICKER_BASE_WIDTH = 320;
const PICKER_BASE_HEIGHT = 416;

export default function ColorPopover({
  value,
  onChange,
  open,
  onClose,
  onPickFromCanvas,
}) {
  const wrapperRef = useRef(null);
  const contentRef = useRef(null);
  const inputId = useId();
  const [hex, setHex] = useState(value || "#ffffff");
  const [iconError, setIconError] = useState(false);
  const [wrapperSize, setWrapperSize] = useState({
    width: PICKER_BASE_WIDTH * PICKER_SCALE,
    height: PICKER_BASE_HEIGHT * PICKER_SCALE,
  });

  useEffect(() => setHex(value || "#ffffff"), [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) onClose?.();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setIconError(false);
  }, [open]);

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
    if (!open) return;
    const el = document.getElementById(inputId);
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      if (typeof el.select === "function") {
        el.select();
      }
    });
  }, [open, inputId]);

  const handlePick = async () => {
    try {
      if (window.EyeDropper) {
        const ed = new window.EyeDropper();
        const { sRGBHex } = await ed.open();
        onChange?.(sRGBHex);
        setHex(sRGBHex);
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
            onChange={(c) => {
              setHex(c);
              onChange?.(c);
            }}
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
                const normalized = c.startsWith("#") ? c : `#${c}`;
                setHex(normalized);
                onChange?.(normalized);
              }}
              prefixed
              className={styles.hexInput}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
