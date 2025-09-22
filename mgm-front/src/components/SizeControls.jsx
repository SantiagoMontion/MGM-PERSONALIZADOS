// src/components/SizeControls.jsx
import { useEffect, useRef, useState } from 'react';
import styles from './SizeControls.module.css';
import { LIMITS, STANDARD, GLASSPAD_SIZE_CM } from '../lib/material.js';

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

  const [wText, setWText] = useState(String(size.w || ''));
  const [hText, setHText] = useState(String(size.h || ''));

  useEffect(() => { setWText(String(size.w ?? '')); }, [size.w]);
  useEffect(() => { setHText(String(size.h ?? '')); }, [size.h]);

  const glasspadInitRef = useRef(false);
  useEffect(() => {
    if (material !== 'Glasspad') {
      glasspadInitRef.current = false;
      return;
    }
    if (glasspadInitRef.current && !disabled) return;

    setWText(prev => {
      const target = String(GLASSPAD_SIZE_CM.w);
      return prev === target ? prev : target;
    });
    setHText(prev => {
      const target = String(GLASSPAD_SIZE_CM.h);
      return prev === target ? prev : target;
    });

    if (disabled) {
      glasspadInitRef.current = false;
      return;
    }

    onChange?.({ w: GLASSPAD_SIZE_CM.w, h: GLASSPAD_SIZE_CM.h });
    glasspadInitRef.current = true;
  }, [material, onChange, disabled]);

  const numPattern = /^[0-9]{0,3}(\.[0-9]{0,2})?$/;

  const handleWChange = (e) => {
    if (disabled || locked || isGlasspad) return;
    const v = e.target.value;
    if (v === '' || numPattern.test(v)) setWText(v);
  };
  const handleHChange = (e) => {
    if (disabled || locked || isGlasspad) return;
    const v = e.target.value;
    if (v === '' || numPattern.test(v)) setHText(v);
  };
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const handleWBlur = () => {
    if (disabled || locked || isGlasspad) return;
    const num = clamp(parseFloat(wText || '0'), 1, limits.maxW);
    setWText(num ? String(num) : '');
    onChange({ w: num, h: parseFloat(hText || size.h) });
  };
  const handleHBlur = () => {
    if (disabled || locked || isGlasspad) return;
    const num = clamp(parseFloat(hText || '0'), 1, limits.maxH);
    setHText(num ? String(num) : '');
    onChange({ w: parseFloat(wText || size.w), h: num });
  };

  const applyPreset = (w, h) => {
    if (disabled || locked) return;
    setWText(String(w));
    setHText(String(h));
    onChange({ w, h });
  };

  const containerClasses = [
    styles.container,
    disabled ? styles.containerDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');
  const inputControlClassName = [
    styles.inputControl,
    disabled ? styles.inputControlDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');
  const selectControlClassName = [
    styles.selectControl,
    disabled ? styles.selectControlDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses} aria-disabled={disabled}>
      <div className={styles.section}>
        <span className={styles.groupLabel}>Medidas (cm)</span>
        <div className={styles.dimensionsRow}>
          <label className={styles.inputLabel}>
            Largo
            <div className={inputControlClassName}>
              <input
                className={styles.input}
                value={isGlasspad ? GLASSPAD_SIZE_CM.w : wText}
                onChange={!isGlasspad ? handleWChange : undefined}
                onBlur={!isGlasspad ? handleWBlur : undefined}
                inputMode="decimal"
                pattern="[0-9]*"
                disabled={locked || isGlasspad || disabled}
              />
            </div>
          </label>
          <label className={styles.inputLabel}>
            Ancho
            <div className={inputControlClassName}>
              <input
                className={styles.input}
                value={isGlasspad ? GLASSPAD_SIZE_CM.h : hText}
                onChange={!isGlasspad ? handleHChange : undefined}
                onBlur={!isGlasspad ? handleHBlur : undefined}
                inputMode="decimal"
                pattern="[0-9]*"
                disabled={locked || isGlasspad || disabled}
              />
            </div>
          </label>
        </div>

        {presets.length > 0 && (
          <div className={styles.presets}>
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

      <label className={`${styles.section} ${styles.selectSection}`}>
        <span className={styles.groupLabel}>Serie</span>
        <div className={selectControlClassName}>
          <select
            className={styles.select}
            value={material}
            onChange={(e) => {
              if (disabled) return;
              onChange({ material: e.target.value });
            }}
            disabled={disabled}
          >
            <option>Classic</option>
            <option>PRO</option>
            <option>Glasspad</option>
          </select>
        </div>
      </label>
    </div>
  );
}
