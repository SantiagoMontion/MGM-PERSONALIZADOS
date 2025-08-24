import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { STANDARD, LIMITS } from '../lib/sizes';
import { dpiFor, dpiLevel } from '../lib/dpi';
import styles from './OptionsStep.module.css';

const Form = z.object({
  material: z.enum(['Classic','PRO']),
  sizeMode: z.enum(['standard','custom']),
  w: z.number().positive(),
  h: z.number().positive(),
  fit: z.enum(['cover','contain']),
  bg: z.string().optional()
});

export default function OptionsStep({ uploaded, onSubmitted }) {
  const [material, setMaterial] = useState('Classic');
  const [sizeMode, setSizeMode] = useState('standard');
  const [std, setStd] = useState({ w: 90, h: 40 });
  const [custom, setCustom] = useState({ w: 90, h: 40 });
  const [fit, setFit] = useState('cover');
  const [bg, setBg] = useState('#ffffff');
  const [imgPx, setImgPx] = useState({ w: 0, h: 0 }); // natural px
  const [ackLow, setAckLow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Leer dimensiones reales de la imagen
  useEffect(() => {
    if (!uploaded?.file) return;
    const url = URL.createObjectURL(uploaded.file);
    const img = new Image();
    img.onload = () => {
      setImgPx({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [uploaded]);

  const size = sizeMode === 'standard' ? std : custom;
  const limits = LIMITS[material];

  // DPI estimado
  const dpiVal = useMemo(() => dpiFor(size.w, size.h, imgPx.w, imgPx.h), [size, imgPx]);
const level = useMemo(() => dpiLevel(dpiVal, 300, 100), [dpiVal]);

  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      // validar y clamp
      const w = clamp(Number(size.w), 1, limits.maxW);
      const h = clamp(Number(size.h), 1, limits.maxH);

      const form = Form.parse({
        material, sizeMode, w, h, fit, bg
      });

      if (level === 'bad' && !ackLow) {
        setErr('La calidad parece baja. Confirmá que aceptás continuar.');
        setBusy(false);
        return;
      }

      // precio (MVP: placeholder; luego conectamos tu calculadora)
      const price_amount = 45900; // TODO: reemplazar con tu calculadora

      const body = {
        customer: undefined,
        design_name: undefined,
        publish_to_shopify: true, // o dejar en false si no querés publicar
        material: form.material,
        size_cm: { w: form.w, h: form.h, bleed_mm: 3 },
        fit_mode: form.fit,
        bg: form.bg || '#ffffff',
        file_original_url: uploaded.file_original_url,
        file_hash: uploaded.file_hash,
        dpi_report: { dpi: Math.round(dpiVal), level, customer_ack: ackLow },
        notes: '',
        price: { currency: 'ARS', amount: price_amount },
        source: 'web'
      };

      const idem = nanoid();
      const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/submit-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem },
        body: JSON.stringify(body)
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error || 'submit_failed');

      // listo: pasamos job_id al padre para ir a confirm
      onSubmitted({ job_id: out.job_id });
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.container}>
      <h2>2) Ajustes</h2>

      <div className={styles.twoColGrid}>
        <label>Material
          <select value={material} onChange={e=>setMaterial(e.target.value)}>
            <option>Classic</option>
            <option>PRO</option>
          </select>
        </label>

        <label>Modo de tamaño
          <select value={sizeMode} onChange={e=>setSizeMode(e.target.value)}>
            <option value="standard">Estándar</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>
      </div>

      {sizeMode === 'standard' ? (
        <div className={styles.standardSelect}>
          <select value={`${std.w}x${std.h}`} onChange={(e)=>{
            const [w,h]=e.target.value.split('x').map(Number);
            setStd({w,h});
          }}>
            {STANDARD[material].map(s => (
              <option key={`${s.w}x${s.h}`} value={`${s.w}x${s.h}`}>
                {s.w}x{s.h} cm
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className={styles.gridMt8}>
          <label>Ancho (cm)
            <input type="number" min="1" max={limits.maxW} value={custom.w}
                   onChange={e=>setCustom(v=>({...v, w: Number(e.target.value)}))}/>
          </label>
          <label>Alto (cm)
            <input type="number" min="1" max={limits.maxH} value={custom.h}
                   onChange={e=>setCustom(v=>({...v, h: Number(e.target.value)}))}/>
          </label>
          <small>Máximo {limits.maxW}×{limits.maxH} para {material}</small>
        </div>
      )}

      <div className={styles.gridMt8}>
        <label>Encaje
          <select value={fit} onChange={e=>setFit(e.target.value)}>
            <option value="cover">Cubrir (recorta)</option>
            <option value="contain">Contener (bordes)</option>
          </select>
        </label>
        <label>Fondo (si “contener”)
          <input type="color" value={bg} onChange={e=>setBg(e.target.value)} />
        </label>
      </div>

      <div className={styles.dpiSection}>
        <b>DPI estimado:</b> {Math.round(dpiVal)} — {
          level === 'ok' ? 'Excelente' : level === 'warn' ? 'Buena' : 'Baja'
        }
        {level === 'bad' && (
          <div className={styles.ackRow}>
            <label>
              <input type="checkbox" checked={ackLow} onChange={e=>setAckLow(e.target.checked)} />
              Soy consciente de la baja calidad y quiero continuar.
            </label>
          </div>
        )}
      </div>

      {err && <p className="errorText">{err}</p>}
      <button className={styles.submitButton} disabled={busy} onClick={submit}>
        {busy ? 'Enviando…' : 'Continuar'}
      </button>
    </div>
  );
}
