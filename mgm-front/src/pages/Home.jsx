// src/pages/Home.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import UploadStep from '../components/UploadStep';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';

import { dpiLevel } from '../lib/dpi';
import { sha256Hex } from '../lib/hash.js';
import { buildSubmitJobBody, prevalidateSubmitBody } from '../lib/jobPayload.js';
import { submitJob as submitJobApi } from '../lib/submitJob.js';
import styles from './Home.module.css';

export default function Home() {
  const navigate = useNavigate();

  // archivo subido
  const [uploaded, setUploaded] = useState(null);

  // crear ObjectURL una sola vez
  const [imageUrl, setImageUrl] = useState(null);
  useEffect(() => {
    if (uploaded?.localUrl) {
      setImageUrl(uploaded.localUrl);
      return () => URL.revokeObjectURL(uploaded.localUrl);
    } else {
      setImageUrl(null);
    }
  }, [uploaded?.localUrl]);

  // medidas y material (source of truth)
  const [material, setMaterial] = useState('Classic');
  const [mode, setMode] = useState('standard');
  const [size, setSize] = useState({ w: 90, h: 40 });
  const sizeCm = useMemo(() => ({ w: Number(size.w) || 90, h: Number(size.h) || 40 }), [size.w, size.h]);

  // layout del canvas
  const [layout, setLayout] = useState(null);
  const [designName, setDesignName] = useState('');
  const [ackLow, setAckLow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const effDpi = useMemo(() => {
    if (!layout) return null;
    return Math.round(
      Math.min(
        layout.dpi / Math.max(1e-6, layout.transform.scaleX),
        layout.dpi / Math.max(1e-6, layout.transform.scaleY)
      )
    );
  }, [layout]);
  const level = useMemo(() => (effDpi ? dpiLevel(effDpi, 300, 100) : null), [effDpi]);

  async function handleContinue() {
    if (!uploaded?.file || !layout) {
      setErr('Falta imagen o layout');
      return;
    }
    if (!designName.trim()) {
      setErr('Falta el nombre del modelo');
      return;
    }
    try {
      setBusy(true);
      setErr('');

      // 1) calcular hash local
      const file_hash = await sha256Hex(uploaded.file);

      // 2) pedir signed URL
      const API_BASE = (import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app').replace(/\/$/, '');
      const ext = (uploaded.file.name.split('.').pop() || 'png').toLowerCase();
      const mime = uploaded.file.type || 'image/png';
      const size_bytes = uploaded.file.size;
      const uploadUrlRes = await fetch(`${API_BASE}/api/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          design_name: designName,
          ext,
          mime,
          size_bytes,
          material,
          w_cm: sizeCm.w,
          h_cm: sizeCm.h,
          sha256: file_hash,
        }),
      });
      const uploadUrlJson = await uploadUrlRes.json();
      if (!uploadUrlRes.ok) throw new Error(uploadUrlJson?.error || 'upload_url_failed');

      // 3) PUT binario a signed_url
      await fetch(uploadUrlJson.upload.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': mime },
        body: uploaded.file,
      });

      // 4) construir URL canónica
      const supaBase = (import.meta.env.VITE_SUPABASE_URL || '').trim();
      const file_original_url = `${supaBase.replace(/\/$/, '')}/storage/v1/object/uploads/${uploadUrlJson.object_key}`;

      // 4b) actualizar estado uploaded
      setUploaded(prev => ({
        ...(prev || {}),
        object_key: uploadUrlJson.object_key,
        file_original_url,
        file_hash,
      }));

      // 5) construir payload submit-job
      const submitBody = buildSubmitJobBody({
        material,
        size: { w: sizeCm.w, h: sizeCm.h, bleed_mm: 3 },
        fit_mode: 'cover',
        bg: '#ffffff',
        dpi: 300,
        uploads: { canonical: file_original_url },
        file_hash,
        price: { amount: 45900, currency: 'ARS' },
        design_name: designName,
        notes: designName,
        source: 'web',
      });

      // 6) prevalidar sin pegarle a la API
      const pre = prevalidateSubmitBody(submitBody);
      console.log('[PREVALIDATE]', { ok: pre.ok, problems: pre.problems, submitBody });
      if (!pre.ok) {
        setErr('Corrige antes de continuar: ' + pre.problems.join(' | '));
        setBusy(false);
        return;
      }

      // 7) submit-job
      const job = await submitJobApi(API_BASE, submitBody);

      // 8) navegar a confirm
      navigate(`/confirm?job_id=${job.job_id}`);
    } catch (e) {
      console.error(e);
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        {uploaded && (
          <>
            <div className={styles.field}>
              <input
                type="text"
                placeholder="Nombre del modelo"
                value={designName}
                onChange={e => setDesignName(e.target.value)}
              />
            </div>
            <SizeControls
              material={material}
              size={size}
              mode={mode}
              onChange={({ material: m, mode: md, w, h }) => {
                setMaterial(m);
                setMode(md);
                setSize({ w, h });
              }}
            />
          </>
        )}
      </div>

      <div className={styles.main}>
        <UploadStep onUploaded={file => { setUploaded(file); setAckLow(false); }} />

        <EditorCanvas
          imageUrl={imageUrl}
          imageFile={uploaded?.file}
          sizeCm={sizeCm}
          bleedMm={3}
          dpi={300}
          onLayoutChange={setLayout}
        />

        {uploaded && level === 'bad' && (
          <label className={styles.ackLabel}>
            <input
              type="checkbox"
              checked={ackLow}
              onChange={e => setAckLow(e.target.checked)}
            />{' '}
            Acepto imprimir en baja calidad ({effDpi} DPI)
          </label>
        )}

        {uploaded && (
          <button className={styles.continueButton} disabled={busy} onClick={handleContinue}>
            Continuar
          </button>
        )}

        {err && <p className={`errorText ${styles.error}`}>{err}</p>}
      </div>
    </div>
  );
}
