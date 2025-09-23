import { useEffect, useId, useMemo, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { resolveIconAsset } from "@/lib/iconRegistry.js";
import styles from "./EditorCanvas.module.css";

const EYEDROPPER_ICON_SRC = resolveIconAsset("tintero.svg", {
  fallbackToPublic: false,
});

const PICKER_SCALE = 0.5;
const PICKER_BASE_WIDTH = 320;
const PICKER_BASE_HEIGHT = 416;

const computeReadableTextColor = (hex) => {
  if (!hex) return "#f9fafb";
  let normalized = hex.trim().replace(/^#/, "");
  if (normalized.length === 3) {
    normalized = normalized
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (normalized.length !== 6) return "#f9fafb";
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return "#f9fafb";
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 155 ? "#111827" : "#f9fafb";
};

const PencilIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M4.25 20l3.9-.84L18.6 8.71a1.75 1.75 0 0 0 0-2.47l-2.84-2.84a1.75 1.75 0 0 0-2.47 0L2.84 15.9 2 20.75" />
    <path d="M12.92 5.08l6 6" />
  </svg>
);

const GridIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5v17" />
  </svg>
);

const BlankIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
  </svg>
);

export default function ColorPopover({
  value,
  onChange,
  open,
  onClose,
  onPickFromCanvas,
  activeMode,
  onToggleMode,
  quality,
}) {
  const wrapperRef = useRef(null);
  const contentRef = useRef(null);
  const inputId = useId();
  const [hex, setHex] = useState(value || "#ffffff");
  const [iconError, setIconError] = useState(false);
  const inputRef = useRef(null);
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
    const el = inputRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      if (typeof el.select === "function") {
        el.select();
      }
    });
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

  const normalizedHex = hex?.startsWith("#") ? hex : `#${hex}`;
  const hexTextColor = useMemo(
    () => computeReadableTextColor(normalizedHex),
    [normalizedHex],
  );
  const qualityLabel = quality?.label ? quality.label : "—";
  const qualityColor = quality?.color ? quality.color : "#f9fafb";

  if (!open) return null;

  const showEyedropperIcon = EYEDROPPER_ICON_SRC && !iconError;

  const wrapperStyle = {
    "--picker-scale": PICKER_SCALE,
    width: `${wrapperSize.width}px`,
    height: `${wrapperSize.height}px`,
  };

  const handleModeClick = (mode) => {
    if (!onToggleMode) return;
    onToggleMode(mode);
  };

  const focusHexInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof el.select === "function") {
      el.select();
    }
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
          <div
            className={styles.hexInputWrapper}
            style={{ background: normalizedHex, color: hexTextColor }}
          >
            <button
              type="button"
              title="Elegir del lienzo"
              aria-label="Elegir color del lienzo"
              onClick={handlePick}
              className={styles.hexIconButton}
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
              ref={inputRef}
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
              style={{ color: hexTextColor }}
            />
            <button
              type="button"
              className={`${styles.hexIconButton} ${styles.hexIconButtonRight}`}
              onClick={focusHexInput}
              title="Editar código hexadecimal"
              aria-label="Editar código hexadecimal"
            >
              <PencilIcon className={styles.panelIcon} />
            </button>
          </div>
          <div className={styles.modeToggleRow}>
            <button
              type="button"
              onClick={() => handleModeClick("contain")}
              className={`${styles.modeToggleButton} ${
                activeMode === "contain" ? styles.modeToggleButtonActive : ""
              }`}
              aria-pressed={activeMode === "contain"}
            >
              <GridIcon className={styles.modeToggleIcon} />
              <span>Contener</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeClick("cover")}
              className={`${styles.modeToggleButton} ${
                activeMode === "cover" ? styles.modeToggleButtonActive : ""
              }`}
              aria-pressed={activeMode === "cover"}
            >
              <BlankIcon className={styles.modeToggleIcon} />
              <span>Diseño completo</span>
            </button>
            <span className={styles.qualityText} style={{ color: qualityColor }}>
              Calidad: {qualityLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
