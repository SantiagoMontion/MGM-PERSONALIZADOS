import { useEffect, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import styles from "./EditorCanvas.module.css";

const iconModules = import.meta.glob("../icons/*.{svg,png}", {
  eager: true,
  import: "default",
});

const resolveIconAsset = (fileName) => {
  const normalized = `../icons/${fileName}`;
  const directMatch = iconModules[normalized];
  if (directMatch) return directMatch;

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".svg")) {
    const pngKey = normalized.replace(/\.svg$/i, ".png");
    if (iconModules[pngKey]) {
      return iconModules[pngKey];
    }
  } else if (lower.endsWith(".png")) {
    const svgKey = normalized.replace(/\.png$/i, ".svg");
    if (iconModules[svgKey]) {
      return iconModules[svgKey];
    }
  }

  return `/icons/${fileName}`;
};

const EYEDROPPER_ICON = resolveIconAsset("tintero.svg");

export default function ColorPopover({
  value,
  onChange,
  open,
  onClose,
  onPickFromCanvas,
}) {
  const boxRef = useRef(null);
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
      </div>
      <div className={styles.colorControls}>
        <span
          className={styles.previewDot}
          style={{ background: hex }}
          aria-hidden="true"
        />
        <div className={styles.hexField}>
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
          {iconError ? (
            <span className={styles.eyedropperFallback} aria-hidden="true" />
          ) : (
            <img
              src={EYEDROPPER_ICON}
              alt="Tomar color del lienzo"
              className={styles.eyedropperIcon}
              onError={() => setIconError(true)}
            />
          )}
        </button>
      </div>
      <div className={styles.swatches}>
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => {
              setHex(c);
              onChange?.(c);
            }}
            className={styles.swatch}
            style={{ background: c }}
            data-selected={hex.toLowerCase() === c.toLowerCase()}
          />
        ))}
      </div>
    </div>
  );
}
