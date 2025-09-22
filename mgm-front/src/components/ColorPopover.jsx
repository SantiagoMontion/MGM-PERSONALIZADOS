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
