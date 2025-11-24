// src/components/SizeControls.jsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './SizeControls.module.css';
import {
  LIMITS,
  STANDARD,
  GLASSPAD_SIZE_CM,
  MIN_DIMENSION_CM_BY_MATERIAL,
} from '../lib/material.js';
import { useFloatingMenu } from '../hooks/useFloatingMenu.js';
const WIDTH_ICON_URL = '/icons/largo.png';
const HEIGHT_ICON_URL = '/icons/ancho.png';



const INVALID_NUMBER_MESSAGE = 'Ingresá un número';
const FALLBACK_DIMENSION_MIN_CM = 1;
const DECIMALS = 2;
const EPSILON = 1e-4;

const clampValue = (val, min, max) => Math.max(min, Math.min(max, val));

const roundToDecimals = (value, decimals = DECIMALS) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return NaN;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const toNumeric = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
};

const formatDisplayValue = (value) => {
  const numeric = toNumeric(value);
  if (!Number.isFinite(numeric)) return '';
  const rounded = roundToDecimals(numeric);
  if (!Number.isFinite(rounded)) return '';
  if (Number.isInteger(rounded)) {
    return String(Math.trunc(rounded));
  }
  return rounded
    .toFixed(DECIMALS)
    .replace(/\.?0+$/, '')
    .replace(/\.$/, '');
};

const MATERIAL_OPTIONS = [
  { value: 'Glasspad', main: 'GLASSPAD', variant: 'speed' },
  { value: 'PRO', main: 'PRO', variant: 'control' },
  { value: 'Classic', main: 'CLASSIC', variant: 'híbrido' },
  { value: 'Alfombra', main: 'ALFOMBRA', variant: 'para piso', disabled: true },
];

const MOBILE_QUERY = '(max-width: 768px)';

const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQueryList = window.matchMedia(query);
    const handleChange = (event) => {
      setMatches(event.matches);
    };

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange);
    } else if (typeof mediaQueryList.addListener === 'function') {
      mediaQueryList.addListener(handleChange);
    }

    setMatches(mediaQueryList.matches);

    return () => {
      if (typeof mediaQueryList.removeEventListener === 'function') {
        mediaQueryList.removeEventListener('change', handleChange);
      } else if (typeof mediaQueryList.removeListener === 'function') {
        mediaQueryList.removeListener(handleChange);
      }
    };
  }, [query]);

  return matches;
};

/**
 * Props:
 * - material: 'Classic' | 'PRO' | 'Glasspad' | 'Alfombra'
 * - size: { w, h }
 * - onChange: ({ material?, w?, h? }) => void
 */
export default function SizeControls({ material, size, onChange, locked = false, disabled = false }) {
  const limits = LIMITS[material] || { maxW: size.w, maxH: size.h };
  const isGlasspad = material === 'Glasspad';
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const filteredPresets = useMemo(() => {
    if (isGlasspad) return [];
    const presets = STANDARD[material] || [];
    
    return presets;
  }, [isGlasspad, material, isMobile]);

  const widthErrorId = useId();
  const heightErrorId = useId();

  const [wText, setWText] = useState(formatDisplayValue(size.w));
  const [hText, setHText] = useState(formatDisplayValue(size.h));
  const [errors, setErrors] = useState({ w: '', h: '' });
  const [isSeriesOpen, setSeriesOpen] = useState(false);

  const seriesTriggerRef = useRef(null);
  const seriesMenuRef = useRef(null);
  const seriesMenuId = useId();
  const floatingMenuStyle = useFloatingMenu(seriesTriggerRef, isSeriesOpen);
  const portalTarget = typeof document !== 'undefined'
    ? document.getElementById('portal-root') || document.body
    : null;
  const wInputRef = useRef(null);
  const hInputRef = useRef(null);
  const initialW = toNumeric(size.w);
  const initialH = toNumeric(size.h);
  const lastCommittedRef = useRef({
    w: Number.isFinite(initialW) ? roundToDecimals(initialW) : null,
    h: Number.isFinite(initialH) ? roundToDecimals(initialH) : null,
  });

  useEffect(() => {
    const numericW = toNumeric(size.w);
    setWText(formatDisplayValue(numericW));
    if (Number.isFinite(numericW)) {
      lastCommittedRef.current.w = roundToDecimals(numericW);
    } else {
      lastCommittedRef.current.w = null;
    }
    setErrors((prev) => {
      if (!prev.w) return prev;
      return { ...prev, w: '' };
    });
  }, [size.w]);

  useEffect(() => {
    const numericH = toNumeric(size.h);
    setHText(formatDisplayValue(numericH));
    if (Number.isFinite(numericH)) {
      lastCommittedRef.current.h = roundToDecimals(numericH);
    } else {
      lastCommittedRef.current.h = null;
    }
    setErrors((prev) => {
      if (!prev.h) return prev;
      return { ...prev, h: '' };
    });
  }, [size.h]);

  const glasspadInitRef = useRef(false);
  useEffect(() => {
    if (material !== 'Glasspad') {
      glasspadInitRef.current = false;
      return;
    }
    if (glasspadInitRef.current && !disabled) return;

    const targetW = formatDisplayValue(GLASSPAD_SIZE_CM.w);
    const targetH = formatDisplayValue(GLASSPAD_SIZE_CM.h);
    setWText((prev) => (prev === targetW ? prev : targetW));
    setHText((prev) => (prev === targetH ? prev : targetH));
    lastCommittedRef.current.w = roundToDecimals(GLASSPAD_SIZE_CM.w);
    lastCommittedRef.current.h = roundToDecimals(GLASSPAD_SIZE_CM.h);
    setErrors((prev) => {
      if (!prev.w && !prev.h) return prev;
      return { w: '', h: '' };
    });

    if (disabled) {
      glasspadInitRef.current = false;
      return;
    }

    onChange?.({ w: GLASSPAD_SIZE_CM.w, h: GLASSPAD_SIZE_CM.h });
    glasspadInitRef.current = true;
  }, [material, onChange, disabled]);

  useEffect(() => {
    if (!isSeriesOpen) return undefined;

    const handlePointerDown = (event) => {
      const triggerEl = seriesTriggerRef.current;
      const menuEl = seriesMenuRef.current;
      if (!triggerEl || !menuEl) return;
      if (triggerEl.contains(event.target) || menuEl.contains(event.target)) {
        return;
      }
      setSeriesOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSeriesOpen(false);
      }
    };

    const handleFocusIn = (event) => {
      const triggerEl = seriesTriggerRef.current;
      const menuEl = seriesMenuRef.current;
      if (!triggerEl || !menuEl) return;
      if (triggerEl.contains(event.target) || menuEl.contains(event.target)) {
        return;
      }
      setSeriesOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [isSeriesOpen]);

  useEffect(() => {
    if (disabled && isSeriesOpen) {
      setSeriesOpen(false);
    }
  }, [disabled, isSeriesOpen]);

  const numPattern = /^[0-9]{0,3}(\.[0-9]{0,2})?$/;

  const focusInputRef = (ref) => {
    setTimeout(() => {
      const input = ref.current;
      if (!input) return;
      input.focus();
      if (typeof input.select === 'function') {
        input.select();
      }
    }, 0);
  };

  const parseAndNormalizeDimension = (field, text) => {
    const normalizedText = (text ?? '').trim().replace(',', '.');
    if (!normalizedText) return { valid: false };
    const parsed = Number.parseFloat(normalizedText);
    if (!Number.isFinite(parsed)) return { valid: false };
    const maxLimit = field === 'w' ? limits.maxW : limits.maxH;
    const max = typeof maxLimit === 'number' && Number.isFinite(maxLimit)
      ? maxLimit
      : Number.POSITIVE_INFINITY;
    const minLimit = field === 'w'
      ? MIN_DIMENSION_CM_BY_MATERIAL[material]?.w ?? FALLBACK_DIMENSION_MIN_CM
      : MIN_DIMENSION_CM_BY_MATERIAL[material]?.h ?? FALLBACK_DIMENSION_MIN_CM;
    const clamped = clampValue(parsed, minLimit, max);
    const value = roundToDecimals(clamped);
    if (!Number.isFinite(value)) return { valid: false };
    return { valid: true, value, display: formatDisplayValue(value) };
  };

  const handleWChange = (e) => {
    if (disabled || locked || isGlasspad) return;
    const v = e.target.value;
    if (v === '' || numPattern.test(v)) {
      setWText(v);
      setErrors((prev) => {
        if (!prev.w) return prev;
        return { ...prev, w: '' };
      });
    }
  };
  const handleHChange = (e) => {
    if (disabled || locked || isGlasspad) return;
    const v = e.target.value;
    if (v === '' || numPattern.test(v)) {
      setHText(v);
      setErrors((prev) => {
        if (!prev.h) return prev;
        return { ...prev, h: '' };
      });
    }
  };

  const revertDimension = (field) => {
    const inputRef = field === 'w' ? wInputRef : hInputRef;
    const lastValue = lastCommittedRef.current[field];
    const fallbackSource = Number.isFinite(lastValue)
      ? lastValue
      : field === 'w'
        ? size.w
        : size.h;
    const fallbackDisplay = formatDisplayValue(fallbackSource);
    if (field === 'w') {
      setWText(fallbackDisplay);
    } else {
      setHText(fallbackDisplay);
    }
    setErrors((prev) => {
      if (!prev[field]) return prev;
      return { ...prev, [field]: '' };
    });
    focusInputRef(inputRef);
  };

  const commitDimension = (field) => {
    if (disabled || locked || isGlasspad) return { status: 'disabled' };
    const inputRef = field === 'w' ? wInputRef : hInputRef;
    const text = field === 'w' ? wText : hText;
    const result = parseAndNormalizeDimension(field, text);
    if (!result.valid) {
      const lastValue = lastCommittedRef.current[field];
      const fallbackSource = Number.isFinite(lastValue)
        ? lastValue
        : field === 'w'
          ? size.w
          : size.h;
      const fallbackDisplay = formatDisplayValue(fallbackSource);
      if (field === 'w') {
        setWText(fallbackDisplay);
      } else {
        setHText(fallbackDisplay);
      }
      setErrors((prev) => ({ ...prev, [field]: INVALID_NUMBER_MESSAGE }));
      focusInputRef(inputRef);
      return { status: 'error' };
    }

    const { value, display } = result;
    const previousValue = lastCommittedRef.current[field];

    if (field === 'w') {
      setWText(display);
    } else {
      setHText(display);
    }

    setErrors((prev) => {
      if (!prev[field]) return prev;
      return { ...prev, [field]: '' };
    });

    if (typeof previousValue === 'number' && Number.isFinite(previousValue)) {
      if (Math.abs(previousValue - value) < EPSILON) {
        lastCommittedRef.current[field] = value;
        return { status: 'unchanged', value, display };
      }
    }

    lastCommittedRef.current[field] = value;
    if (field === 'w') {
      onChange?.({ w: value });
    } else {
      onChange?.({ h: value });
    }

    return { status: 'saved', value, display };
  };

  const handleDimensionKeyDown = (field) => (event) => {
    if (disabled || locked || isGlasspad) return;
    if (event.key === 'Enter' && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      const outcome = commitDimension(field);
      if (outcome.status !== 'error') {
        event.currentTarget.blur();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      revertDimension(field);
    }
  };

  const handleWBlur = () => { commitDimension('w'); };
  const handleHBlur = () => { commitDimension('h'); };

  const applyPreset = (w, h) => {
    if (disabled || locked) return;
    const numericW = toNumeric(w);
    const numericH = toNumeric(h);
    setWText(formatDisplayValue(numericW));
    setHText(formatDisplayValue(numericH));
    if (Number.isFinite(numericW)) {
      lastCommittedRef.current.w = roundToDecimals(numericW);
    }
    if (Number.isFinite(numericH)) {
      lastCommittedRef.current.h = roundToDecimals(numericH);
    }
    setErrors((prev) => {
      if (!prev.w && !prev.h) return prev;
      return { w: '', h: '' };
    });
    if (Number.isFinite(numericW) && Number.isFinite(numericH)) {
      onChange?.({ w: numericW, h: numericH });
    }
  };

  const containerClasses = [
    styles.container,
    styles.fieldBlock,
    disabled ? styles.containerDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const measureFieldClass = (isDisabled) => [
    styles.measureField,
    isDisabled ? styles.measureFieldDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const activeMaterialOption = MATERIAL_OPTIONS.find((option) => option.value === material) || MATERIAL_OPTIONS[0];
  return (
    <div className={containerClasses} aria-disabled={disabled}>
      <div className={`${styles.section} ${styles.formRow}`}>
        <span className={styles.groupLabel}>Medidas (cm)</span>
        <div className={styles.measureRow}>
          <label className={measureFieldClass(locked || isGlasspad || disabled)}>
            <span className={styles.measureLabel}>Largo</span>
            <img src={WIDTH_ICON_URL} alt="" className={styles.measureIcon} aria-hidden="true" />
            <input
              ref={wInputRef}
              className={styles.measureInput}
              value={isGlasspad ? GLASSPAD_SIZE_CM.w : wText}
              onChange={!isGlasspad ? handleWChange : undefined}
              onBlur={!isGlasspad ? handleWBlur : undefined}
              onKeyDown={!isGlasspad ? handleDimensionKeyDown('w') : undefined}
              inputMode="decimal"
              pattern="[0-9]*"
              aria-invalid={errors.w ? 'true' : 'false'}
              aria-describedby={errors.w ? widthErrorId : undefined}
              disabled={locked || isGlasspad || disabled}
            />
          </label>
          <label className={measureFieldClass(locked || isGlasspad || disabled)}>
            <span className={styles.measureLabel}>Ancho</span>
            <img src={HEIGHT_ICON_URL} alt="" className={styles.measureIcon} aria-hidden="true" />
            <input
              ref={hInputRef}
              className={styles.measureInput}
              value={isGlasspad ? GLASSPAD_SIZE_CM.h : hText}
              onChange={!isGlasspad ? handleHChange : undefined}
              onBlur={!isGlasspad ? handleHBlur : undefined}
              onKeyDown={!isGlasspad ? handleDimensionKeyDown('h') : undefined}
              inputMode="decimal"
              pattern="[0-9]*"
              aria-invalid={errors.h ? 'true' : 'false'}
              aria-describedby={errors.h ? heightErrorId : undefined}
              disabled={locked || isGlasspad || disabled}
            />
          </label>
        </div>

        {(errors.w || errors.h) && (
          <div className={styles.measureErrors}>
            {errors.w && (
              <p className={styles.measureError} id={widthErrorId} aria-live="polite">
                {errors.w}
              </p>
            )}
            {errors.h && (
              <p className={styles.measureError} id={heightErrorId} aria-live="polite">
                {errors.h}
              </p>
            )}
          </div>
        )}

        {filteredPresets.length > 0 && (
          <div className={styles.quickSizes}>
            {filteredPresets.map(p => (
              <button
                key={`${p.w}x${p.h}`}
                type="button"
                className={styles.quickChip}
                onClick={() => applyPreset(p.w, p.h)}
                disabled={locked || disabled}
              >
                {p.w}×{p.h}
              </button>
            ))}
          </div>
        )}

        
      </div>

      <div className={`${styles.section} ${styles.seriesSection} ${styles.formRow}`}>
  <span className={styles.groupLabel}>Serie</span>
  <div className={styles.selectGroup}>
    <button
      type="button"
      className={styles.selectTrigger}
      aria-haspopup="listbox"
      aria-expanded={isSeriesOpen}
      aria-controls={seriesMenuId}
      ref={seriesTriggerRef}
      onClick={() => {
        if (disabled) return;
        setSeriesOpen((prev) => !prev);
      }}
      disabled={disabled}
    >
      <span className={styles.selectLabel}>
        <strong className={styles.selectLabelStrong}>{activeMaterialOption.main}</strong>
        <em className={styles.selectLabelSoft}>{activeMaterialOption.variant}</em>
      </span>
      <svg className={styles.selectChevron} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </button>

    {isSeriesOpen
      && seriesTriggerRef.current
      && portalTarget
      && createPortal(
        (
          <div
            id={seriesMenuId}
            role="listbox"
            className={styles.selectMenu}
            style={floatingMenuStyle}
            ref={seriesMenuRef}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          >
            {MATERIAL_OPTIONS.map((option) => {
              const isActive = material === option.value;
              const optionClasses = [
                styles.selectOption,
                option.disabled ? styles.selectOptionDisabled : '',
              ]
                .filter(Boolean)
                .join(' ');
              const closeSeriesMenu = () => {

                setSeriesOpen(false);

                if (disabled || option.disabled) return;
                if (String(option.value) !== String(material)) {
                  onChange({ material: option.value });
                }


              };
              return (
                <div
                  role="option"
                  key={option.value}
                  aria-selected={isActive}
                  aria-disabled={option.disabled ? 'true' : 'false'}
                  className={optionClasses}
                  tabIndex={option.disabled ? -1 : 0}
                  onClick={(event) => {
                    event.preventDefault();

                    if (option.disabled) return;
                    closeSeriesMenu();

                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();

                      if (option.disabled) return;
                      closeSeriesMenu();

                    }
                  }}
                >
                  <span className={styles.selectLabel}>
                    <strong className={styles.selectLabelStrong}>{option.main}</strong>
                    <em className={styles.selectLabelSoft}>{option.variant}</em>
                  </span>
                </div>
              );
            })}
          </div>
        ),
        portalTarget,
      )}
  </div>
</div>

    </div>
  );
}
