import { useEffect, useId, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { resolveIconAsset } from "@/lib/iconRegistry.js";
import styles from "./EditorCanvas.module.css";

const EYEDROPPER_ICON_SRC = resolveIconAsset("tintero.svg", {
  fallbackToPublic: false,
});

export default function ColorPopover({
  value,
  onChange,
  open,
  onClose,
  onPickFromCanvas,
}) {
  const boxRef = useRef(null);
  const inputId = useId();
  const [hex, setHex] = useState(value || "#ffffff");
  const [iconError, setIconError] = useState(false);

  useEffect(() => setHex(value || "#ffffff"), [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target)) onClose?.();
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

  return (
    <div ref={boxRef} className={styles.colorPopover}>
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
  );
}
