// src/components/SizeControls.jsx
import { useEffect, useId, useRef, useState } from 'react';
import styles from './SizeControls.module.css';
import { LIMITS, STANDARD, GLASSPAD_SIZE_CM } from '../lib/material.js';
import { resolveIconAsset } from '../lib/iconRegistry.js';

const WIDTH_ICON_SRC = resolveIconAsset('largo.svg');
const HEIGHT_ICON_SRC = resolveIconAsset('ancho.svg');

const INVALID_NUMBER_MESSAGE = 'Ingresá un número';
const DIMENSION_MIN_CM = 1;
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
];

/**
 * Props:
 * - material: 'Classic' | 'PRO' | 'Glasspad'
 * - size: { w, h }
 * - onChange: ({ material?, w?, h? }) => void
 */
export default function SizeControls({ material, size, onChange, locked = false, disabled = false }) {
  const limits = LIMITS[material] || { maxW: size.w, maxH: size.h };
  const presets = STANDARD[material] || [];
  const isGlasspad = material === 'Glasspad';

  const widthErrorId = useId();
  const heightErrorId = useId();

  const [wText, setWText] = useState(formatDisplayValue(size.w));
  const [hText, setHText] = useState(formatDisplayValue(size.h));
  const [errors, setErrors] = useState({ w: '', h: '' });
  const [isSeriesOpen, setSeriesOpen] = useState(false);

  const seriesSelectRef = useRef(null);
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

    const handleClickOutside = (event) => {
      if (!seriesSelectRef.current) return;
      if (!seriesSelectRef.current.contains(event.target)) {
        setSeriesOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isSeriesOpen]);

  useEffect(() => {
    if (disabled && isSeriesOpen) {
      setSeriesOpen(false);
    }
  }, [disabled, isSeriesOpen]);

  useEffect(() => { setSeriesOpen(false); }, [material]);

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
    const clamped = clampValue(parsed, DIMENSION_MIN_CM, max);
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
  const inputControlClassName = [
    styles.inputControl,
    styles.inputNumber,
    disabled ? styles.inputControlDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const activeMaterialOption = MATERIAL_OPTIONS.find((option) => option.value === material) || MATERIAL_OPTIONS[0];
  return (
    <div className={containerClasses} aria-disabled={disabled}>
      <div className={`${styles.section} ${styles.formRow}`}>
        <span className={styles.groupLabel}>Medidas (cm)</span>
        <div className={`${styles.dimensionsRow} ${styles.inputGroup}`}>
          <label className={styles.inputLabel}>
            <span className={styles.visuallyHidden}>Largo</span>
            <div className={inputControlClassName}>
              <span className={styles.inputAffix} aria-hidden="true">
                Largo
              </span>
              <img
                src={WIDTH_ICON_SRC}
                alt=""
                className={styles.inputIcon}
                aria-hidden="true"
              />
              <input
                ref={wInputRef}
                className={`${styles.input} ${styles.inputNumber}`}
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
            </div>
            {errors.w && (
              <p className="errorText" id={widthErrorId} aria-live="polite">
                {errors.w}
              </p>
            )}
          </label>
          <label className={styles.inputLabel}>
            <span className={styles.visuallyHidden}>Ancho</span>
            <div className={inputControlClassName}>
              <span className={styles.inputAffix} aria-hidden="true">
                Ancho
              </span>
              <img
                src={HEIGHT_ICON_SRC}
                alt=""
                className={styles.inputIcon}
                aria-hidden="true"
              />
              <input
                ref={hInputRef}
                className={`${styles.input} ${styles.inputNumber}`}
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
            </div>
            {errors.h && (
              <p className="errorText" id={heightErrorId} aria-live="polite">
                {errors.h}
              </p>
            )}
          </label>
        </div>

        {presets.length > 0 && (
          <div className={`${styles.presets} ${styles.quickSizeChips}`}>
            {presets.map(p => (
              <button
                key={`${p.w}x${p.h}`}
                type="button"
                className={styles.presetButton}
                onClick={() => applyPreset(p.w, p.h)}
                disabled={locked || disabled}
              >
                {p.w}×{p.h}
              </button>
            ))}
          </div>
        )}

        {!locked && !isGlasspad && (
          <p className={styles.helper}>
            Máximo {limits.maxW}×{limits.maxH} cm para {material}
          </p>
        )}

        {locked && (
          <p className={styles.helper}>Medida fija {GLASSPAD_SIZE_CM.w}×{GLASSPAD_SIZE_CM.h} cm</p>
        )}
      </div>

      <div className={`${styles.section} ${styles.seriesSection} ${styles.formRow}`}>
        <span className={styles.groupLabel}>Serie</span>
        <div className={styles.selectGroup} ref={seriesSelectRef}>
          <button
            type="button"
            className={styles.selectTrigger}
            aria-haspopup="listbox"
            aria-expanded={isSeriesOpen}
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

          {isSeriesOpen && (
            <div role="listbox" className={styles.selectMenu}>
              {MATERIAL_OPTIONS.map((option) => {
                const isActive = material === option.value;
                return (
                  <div
                    role="option"
                    key={option.value}
                    aria-selected={isActive}
                    className={styles.selectOption}
                    tabIndex={0}
                    onClick={() => {
                      if (disabled) return;
                      setSeriesOpen(false);
                      if (option.value !== material) {
                        onChange({ material: option.value });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (disabled) return;
                        setSeriesOpen(false);
                        if (option.value !== material) {
                          onChange({ material: option.value });
                        }
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
          )}
        </div>
      </div>
    </div>
  );
}
