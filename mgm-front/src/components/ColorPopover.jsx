import { useEffect, useId, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import styles from "./EditorCanvas.module.css";

const EYEDROPPER_ICON = "/icons/tintero.svg";

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

  return (
    <div ref={boxRef} className={styles.colorPopover}>
      <div className={styles.colorPickerShell}>
        <HexColorPicker
          color={hex}
          onChange={(c) => {
            setHex(c);
            onChange?.(c);
          }}
          className={styles.colorPicker}
        />
        <button
          type="button"
          title="Elegir del lienzo"
          aria-label="Elegir color del lienzo"
          onClick={handlePick}
          className={styles.eyedropperButton}
        >
          {iconError ? (
            <span className={styles.eyedropperFallback} aria-hidden="true" />
          ) : (
            <img
              src={EYEDROPPER_ICON}
              alt=""
              className={styles.eyedropperIcon}
              onError={() => setIconError(true)}
              draggable="false"
            />
          )}
        </button>
      </div>
      <div className={styles.hexField}>
        <label className={styles.hexLabel} htmlFor={inputId}>
          Hex
        </label>
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
  );
}
