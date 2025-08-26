// src/components/SizeControls.jsx
import { useMemo } from 'react';
import styles from './SizeControls.module.css';
import { LIMITS, STANDARD } from '../lib/material.js';

/**
 * Props:
 * - material: 'Classic' | 'PRO'
 * - size: { w, h }
 * - mode: 'standard' | 'custom'
 * - onChange: ({ material, mode, w, h }) => void
 */
export default function SizeControls({ material, size, mode, onChange, locked = false }) {
  const limits = LIMITS[material] || { maxW: size.w, maxH: size.h };
  const standard = STANDARD[material] || [];
  const currentValue = `${size.w}x${size.h}`;

  const options = useMemo(
    () => standard.map(s => ({ label: `${s.w}×${s.h} cm`, value: `${s.w}x${s.h}` })),
    [standard]
  );

  return (
    <div className={styles.container}>
      <label>Material
        <select
          value={material}
          onChange={(e) => {
            const m = e.target.value;
            onChange({ material: m });
          }}
        >
          <option>Classic</option>
          <option>PRO</option>
          <option>Glasspad</option>
        </select>
      </label>

      <label>Modo
        <select
          value={mode}
          onChange={(e) => onChange({ mode: e.target.value })}
          disabled={locked}
        >
          <option value="standard">Estándar</option>
          <option value="custom">Personalizado</option>
        </select>
      </label>

      {mode === 'standard' ? (
        <label>Medida estándar
          <select
            value={currentValue}
            onChange={(e) => {
              const [w, h] = e.target.value.split('x').map(Number);
              onChange({ mode: 'standard', w, h });
            }}
            disabled={locked}
          >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ) : (
        <>
          <label>Ancho (cm)
            <input
              type="number" min="1" max={limits.maxW} value={size.w}
              onChange={(e)=>{
                const w = Math.max(1, Math.min(limits.maxW, Number(e.target.value) || 0));
                onChange({ w, h: size.h });
              }}
              disabled={locked}
            />
          </label>
          <label>Alto (cm)
            <input
              type="number" min="1" max={limits.maxH} value={size.h}
              onChange={(e)=>{
                const h = Math.max(1, Math.min(limits.maxH, Number(e.target.value) || 0));
                onChange({ w: size.w, h });
              }}
              disabled={locked}
            />
          </label>
          {!locked && (
            <small className={styles.helper}>
              Máximo {limits.maxW}×{limits.maxH} cm para {material}
            </small>
          )}
        </>
      )}
      {locked && (
        <small className={styles.helper}>Medida fija 50×40 cm</small>
      )}
    </div>
  );
}
