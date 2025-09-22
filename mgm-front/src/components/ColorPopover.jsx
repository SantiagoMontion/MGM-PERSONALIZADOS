import { useEffect, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import styles from "./EditorCanvas.module.css";

export default function ColorPopover({
  value,
  onChange,
  open,
  onClose,
  onPickFromCanvas,
}) {
  const boxRef = useRef(null);
  const previewRef = useRef(null);
  const [hex, setHex] = useState(value || "#ffffff");

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
    if (previewRef.current) previewRef.current.style.background = hex;
  }, [hex]);

  const handlePick = async () => {
    let picked = false;
    try {
      if (window.EyeDropper) {
        const ed = new window.EyeDropper();
        const { sRGBHex } = await ed.open();
        setHex(sRGBHex);
        onChange?.(sRGBHex);
        picked = true;
      }
    } catch {
      // ignore
    }

    if (!picked) {
      onPickFromCanvas?.();
    }

    onClose?.();
  };

  if (!open) return null;

  return (
    <div ref={boxRef} className={styles.colorPopover}>
      <HexColorPicker
        color={hex}
        onChange={(c) => {
          setHex(c);
          onChange?.(c);
        }}
        className={styles.colorPicker}
      />
      <div className={styles.colorControls}>
        <div ref={previewRef} className={styles.colorPreview} />
        <div className={styles.hexInputGroup}>
          <span className={styles.hexLabel}>Hex</span>
          <HexColorInput
            color={hex}
            onChange={(c) => {
              const v = c.startsWith("#") ? c : `#${c}`;
              setHex(v);
              onChange?.(v);
            }}
            prefixed
            className={styles.hexInput}
          />
        </div>
        <button
          type="button"
          title="Elegir del lienzo"
          onClick={handlePick}
          className={styles.eyedropperButton}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 21l6.6-6.6" />
            <path d="M8.5 2.5a3 3 0 0 1 4.2 4.2L7.5 12 4 8.5 8.5 2.5z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
