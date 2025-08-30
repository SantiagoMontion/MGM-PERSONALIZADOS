// src/components/SizeControls.jsx
import { useEffect, useState, useRef } from 'react';
import styles from './SizeControls.module.css';
import { LIMITS, STANDARD } from '../lib/material.js';

/**
 * Props:
 * - material: 'Classic' | 'PRO' | 'Glasspad'
 * - size: { w, h }
 * - onChange: ({ material?, w?, h? }) => void
 */
export default function SizeControls({ material, size, onChange, locked = false }) {
  const limits = LIMITS[material] || { maxW: size.w, maxH: size.h };
  const presets = STANDARD[material] || [];

  const [wText, setWText] = useState(String(size.w || ''));
  const [hText, setHText] = useState(String(size.h || ''));
  const debouncedApplyRef = useRef(null);

  useEffect(() => { setWText(String(size.w ?? '')); }, [size.w]);
  useEffect(() => { setHText(String(size.h ?? '')); }, [size.h]);

  useEffect(() => {
    if (material === 'Glasspad') {
      setWText('50');
      setHText('40');
      onChange({ w: 50, h: 40 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material]);

  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const applySize = () => {
    const wNum = clamp(parseFloat(wText || '0'), 1, limits.maxW);
    const hNum = clamp(parseFloat(hText || '0'), 1, limits.maxH);
    setWText(String(wNum));
    setHText(String(hNum));
    onChange({ w: wNum, h: hNum });
  };

  const scheduleApply = (val) => {
    if (isNaN(parseFloat(val))) return;
    clearTimeout(debouncedApplyRef.current);
    debouncedApplyRef.current = setTimeout(applySize, 150);
  };

  const applyPreset = (w, h) => {
    setWText(String(w));
    setHText(String(h));
    onChange({ w, h });
  };

  return (
    <div className={styles.container}>
      <label>Material
        <select
          value={material}
          onChange={(e) => onChange({ material: e.target.value })}
        >
          <option>Classic</option>
          <option>PRO</option>
          <option>Glasspad</option>
        </select>
      </label>

      <label>Ancho (cm)
        <input
          type="number"
          step={1}
          min={1}
          max={limits.maxW}
          value={wText}
          onChange={e=>{ setWText(e.target.value); scheduleApply(e.target.value); }}
          onKeyDown={e=>e.key === 'Enter' && applySize()}
          onBlur={applySize}
          inputMode="numeric"
          disabled={locked || material === 'Glasspad'}
        />
      </label>

      <label>Alto (cm)
        <input
          type="number"
          step={1}
          min={1}
          max={limits.maxH}
          value={hText}
          onChange={e=>{ setHText(e.target.value); scheduleApply(e.target.value); }}
          onKeyDown={e=>e.key === 'Enter' && applySize()}
          onBlur={applySize}
          inputMode="numeric"
          disabled={locked || material === 'Glasspad'}
        />
      </label>

      <div className={styles.presets}>
        {presets.map(p => (
          <button key={`${p.w}x${p.h}`} onClick={() => applyPreset(p.w, p.h)} disabled={locked}>
            {p.w}×{p.h}
          </button>
        ))}
      </div>

      {!locked && material !== 'Glasspad' && (
        <small className={styles.helper}>
          Máximo {limits.maxW}×{limits.maxH} cm para {material}
        </small>
      )}

      {locked && (
        <small className={styles.helper}>Medida fija 50×40 cm</small>
      )}
    </div>
  );
}
