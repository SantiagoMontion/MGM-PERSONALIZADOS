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

  const swatches = [
    "#ffffff",
    "#000000",
    "#f3f4f6",
    "#e5e7eb",
    "#d1d5db",
    "#1f2937",
    "#111827",
    "#ff0000",
    "#ff7f00",
    "#ffb800",
    "#ffe600",
    "#00a859",
    "#00c9a7",
    "#00ccff",
    "#0066ff",
    "#6f42c1",
    "#ff69b4",
    "#8b4513",
    "#808080",
    "#333333",
  ];

  const handlePick = async () => {
    try {
      if (window.EyeDropper) {
        const ed = new window.EyeDropper();
        const { sRGBHex } = await ed.open();
        onChange?.(sRGBHex);
        return;
      }
    } catch (err) {
      // ignore
    }
    onPickFromCanvas?.();
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
      <div className={styles.swatches}>
        {swatches.map((c, i) => (
          <button
            key={c}
            title={c}
            onClick={() => {
              setHex(c);
              onChange?.(c);
            }}
            className={`${styles.swatch} ${styles["swatch" + i]}`}
          />
        ))}
      </div>
      <div className={styles.colorControls}>
        <div ref={previewRef} className={styles.colorPreview} />
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
        <button
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
