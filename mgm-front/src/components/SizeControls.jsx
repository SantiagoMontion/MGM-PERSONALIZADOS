// src/components/SizeControls.jsx
import { useMemo } from 'react';
import styles from './SizeControls.module.css';

const LIMITS = {
  Classic: { maxW: 140, maxH: 100 },
  PRO: { maxW: 120, maxH: 60 }
};
const STANDARD = {
  Classic: [
    { w: 25, h: 25 },
    { w: 82, h: 32 },
    { w: 90, h: 40 },
    { w: 100, h: 60 },
    { w: 140, h: 100 }
  ],
  PRO: [
    { w: 25, h: 25 },
    { w: 50, h: 40 },
    { w: 90, h: 40 },
    { w: 120, h: 60 }
  ]
};

/**
 * Props:
 * - material: 'Classic' | 'PRO'
 * - size: { w, h }
 * - mode: 'standard' | 'custom'
 * - onChange: ({ material, mode, w, h }) => void
 */
export default function SizeControls({ material, size, mode, onChange }) {
  const limits = LIMITS[material];
  const standard = STANDARD[material];
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
            const first = STANDARD[m][0];
            onChange({ material: m, mode: 'standard', w: first.w, h: first.h });
          }}
        >
          <option>Classic</option>
          <option>PRO</option>
        </select>
      </label>

      <label>Modo
        <select
          value={mode}
          onChange={(e) => onChange({ material, mode: e.target.value, w: size.w, h: size.h })}
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
              onChange({ material, mode, w, h });
            }}
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
                onChange({ material, mode, w, h: size.h });
              }}
            />
          </label>
          <label>Alto (cm)
            <input
              type="number" min="1" max={limits.maxH} value={size.h}
              onChange={(e)=>{
                const h = Math.max(1, Math.min(limits.maxH, Number(e.target.value) || 0));
                onChange({ material, mode, w: size.w, h });
              }}
            />
          </label>
          <small className={styles.helper}>
            Máximo {limits.maxW}×{limits.maxH} cm para {material}
          </small>
        </>
      )}
    </div>
  );
}
