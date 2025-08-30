import { useEffect, useMemo, useState, useCallback } from 'react';
import { z } from 'zod';
import { STANDARD, LIMITS } from '../lib/material.js';
import { dpiFor, dpiLevel } from '../lib/dpi';
import styles from './OptionsStep.module.css';
import { buildSubmitJobBody, prevalidateSubmitBody } from '../lib/jobPayload';
import { submitJob } from '../lib/submitJob';
import { dlog } from '../lib/debug';

const Form = z.object({
  material: z.enum(['Classic','PRO','Glasspad']),
  w: z.number().positive(),
  h: z.number().positive(),
  fit: z.enum(['cover','contain','stretch']),
  bg: z.string().optional()
});

export default function OptionsStep({ uploaded, onSubmitted }) {
  const [material, setMaterial] = useState('Classic');
  const [wText, setWText] = useState('90');
  const [hText, setHText] = useState('40');
  const [fit, setFit] = useState('cover');
  const [bg, setBg] = useState('#ffffff');
  const [imgPx, setImgPx] = useState({ w: 0, h: 0 });
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

  useEffect(() => {
    if (material === 'Glasspad') {
      applyPreset(50, 40);
    }
  }, [material, applyPreset]);

  const size = useMemo(() => ({ w: parseFloat(wText || '0'), h: parseFloat(hText || '0') }), [wText, hText]);
  const limits = LIMITS[material];
  const presets = STANDARD[material] || [];
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const applySize = useCallback((wVal = wText, hVal = hText) => {
    const wNum = clamp(parseFloat(wVal || '0'), 1, limits.maxW);
    const hNum = clamp(parseFloat(hVal || '0'), 1, limits.maxH);
    setWText(String(wNum));
    setHText(String(hNum));
  }, [wText, hText, limits.maxW, limits.maxH]);
  const applyPreset = useCallback((w, h) => {
    applySize(String(w), String(h));
  }, [applySize]);

  // DPI estimado
  const dpiVal = useMemo(() => dpiFor(size.w, size.h, imgPx.w, imgPx.h), [size, imgPx]);
  const level = useMemo(() => dpiLevel(dpiVal, 300, 100), [dpiVal]);

  async function submit() {
    setErr('');
    setBusy(true);
    try {
    const wNum = clamp(parseFloat(wText || '0'), 1, limits.maxW);
    const hNum = clamp(parseFloat(hText || '0'), 1, limits.maxH);

    if (!wText || !hText) {
      setErr('Completá las medidas');
      setBusy(false);
      return;
    }

    const form = Form.parse({
      material, w: wNum, h: hNum, fit, bg
    });

    if (level === 'bad' && !ackLow) {
      setErr('La calidad parece baja. Confirmá que aceptás continuar.');
      setBusy(false);
      return;
    }

    const submitBody = buildSubmitJobBody({
      material: form.material,
      size: { w: form.w, h: form.h, bleed_mm: 3 },
      fit_mode: form.fit, // 'cover'|'contain'
      bg: form.bg || '#ffffff',
      dpi: Math.round(dpiVal),
      uploads: {
        // tomamos lo que haya en uploaded:
        signed_url: uploaded?.upload?.signed_url || uploaded?.signed_url,
        object_key: uploaded?.object_key,
        canonical: uploaded?.file_original_url,
      },
      file_hash: uploaded?.file_hash,
      price: { amount: 45900, currency: 'ARS' },
      customer: { email: uploaded?.customer_email, name: uploaded?.customer_name },
      notes: '',
      source: 'web',
    });

    const pre = prevalidateSubmitBody(submitBody);
    dlog('[PREVALIDATE OptionsStep]', pre, submitBody);
    if (!pre.ok) {
      setErr('Corregí antes de enviar: ' + pre.problems.join(' | '));
      setBusy(false);
      return;
    }

    const apiBase = (import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app').replace(/\/$/, '');
    const job = await submitJob(apiBase, submitBody);

    onSubmitted({ job_id: job?.job_id || submitBody.job_id });
  } catch (e) {
    setErr(String(e?.message || e));
  } finally {
    setBusy(false);
  }
}
  return (
    <div className={styles.container}>
      <h2>2 Ajustes</h2>

      <div className={styles.twoColGrid}>
        <label>Material
          <select value={material} onChange={e=>setMaterial(e.target.value)}>
            <option>Classic</option>
            <option>PRO</option>
            <option>Glasspad</option>
          </select>
        </label>

        <label>Encaje
          <select value={fit} onChange={e=>setFit(e.target.value)}>
            <option value="cover">Cubrir</option>
            <option value="contain">Contener</option>
            <option value="stretch">Estirar</option>
          </select>
        </label>
      </div>

      <div className={styles.gridMt8}>
        <label>Ancho (cm)
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={wText}
            onChange={e=>setWText(e.target.value)}
            onKeyDown={e=>e.key === 'Enter' && applySize()}
            onBlur={applySize}
            disabled={material === 'Glasspad'}
          />
        </label>
        <label>Alto (cm)
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={hText}
            onChange={e=>setHText(e.target.value)}
            onKeyDown={e=>e.key === 'Enter' && applySize()}
            onBlur={applySize}
            disabled={material === 'Glasspad'}
          />
        </label>
        <small>Máximo {limits.maxW}×{limits.maxH} para {material}</small>
      </div>

      <div className={styles.presets}>
        {presets.map(p => (
          <button key={`${p.w}x${p.h}`} onClick={() => applyPreset(p.w, p.h)}>
            {p.w}×{p.h}
          </button>
        ))}
      </div>

      {fit === 'contain' && (
        <div className={styles.gridMt8}>
          <label>Fondo
            <input type="color" value={bg} onChange={e=>setBg(e.target.value)} />
          </label>
        </div>
      )}

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
