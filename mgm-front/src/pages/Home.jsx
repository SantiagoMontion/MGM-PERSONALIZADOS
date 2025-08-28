// src/pages/Home.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import UploadStep from '../components/UploadStep';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';
import Calculadora from '../components/Calculadora';
import LoadingOverlay from '../components/LoadingOverlay';

import { LIMITS, STANDARD } from '../lib/material.js';

import { dpiLevel } from '../lib/dpi';
import { sha256Hex } from '../lib/hash.js';
import { buildSubmitJobBody, prevalidateSubmitBody } from '../lib/jobPayload.js';
import { submitJob as submitJobApi } from '../lib/submitJob.js';
import styles from './Home.module.css';

export default function Home() {

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
  const lastSize = useRef({
    Classic: { w: 90, h: 40 },
    PRO: { w: 90, h: 40 },
  });

  useEffect(() => {
    if (material === 'Glasspad') {
      setSize({ w: 50, h: 40 });
    }
  }, [material]);

  const [priceAmount, setPriceAmount] = useState(0);
  const priceCurrency = 'ARS';

  // layout del canvas
  const [layout, setLayout] = useState(null);
  const [designName, setDesignName] = useState('');
  const [ackLow, setAckLow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const canvasRef = useRef(null);

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

  function handleSizeChange(next) {
    if (next.material && next.material !== material) {
      if (material !== 'Glasspad') {
        lastSize.current[material] = { ...size };
      }
      if (next.material === 'Glasspad') {
        setMaterial('Glasspad');
        setMode('standard');
        setSize({ w: 50, h: 40 });
        return;
      }
      const lim = LIMITS[next.material];
      const prev = lastSize.current[next.material] || size;
      const clamped = {
        w: Math.min(Math.max(prev.w, 1), lim.maxW),
        h: Math.min(Math.max(prev.h, 1), lim.maxH),
      };
      setMaterial(next.material);
      setSize(clamped);
      const isStd = (STANDARD[next.material] || []).some(
        opt => Number(opt.w) === Number(clamped.w) && Number(opt.h) === Number(clamped.h)
      );
      setMode(isStd ? 'standard' : 'custom');
      return;
    }
    if (next.mode && next.mode !== mode) {
      setMode(next.mode);
      if (next.mode === 'standard' && typeof next.w === 'number' && typeof next.h === 'number') {
        setSize({ w: next.w, h: next.h });
        if (material !== 'Glasspad') {
          lastSize.current[material] = { w: next.w, h: next.h };
        }
      }
    }
    if (typeof next.w === 'number' || typeof next.h === 'number') {
      const nextSize = {
        w: typeof next.w === 'number' ? next.w : size.w,
        h: typeof next.h === 'number' ? next.h : size.h,
      };
      setSize(nextSize);
      if (material !== 'Glasspad') {
        lastSize.current[material] = nextSize;
      }
    }
  }

  async function handleAfterSubmit(jobId) {
    const render = canvasRef.current?.getRenderDescriptor?.();
    const render_v2 = canvasRef.current?.getRenderDescriptorV2?.();
    if (import.meta.env.DEV) {
      const padBlob = await canvasRef.current?.exportPadAsBlob?.();
      window.__previewData = { padBlob, render_v2, jobId };
      navigate('/dev/canvas-preview', { state: { jobId } });
      return;
    }
    navigate(`/creating/${jobId}`, { state: { render, render_v2 } });
  }

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
      if (priceAmount <= 0) {
        setErr('Precio no disponible');
        return;
      }
      setErr('');
      setBusy(true);

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
      console.log('[PRICE DEBUG]', {
        material,
        width_cm: Number(size.w),
        height_cm: Number(size.h),
        priceAmount,
      });

      const submitBody = buildSubmitJobBody({
        material,
        size: { w: sizeCm.w, h: sizeCm.h, bleed_mm: 3 },
        fit_mode: 'cover',
        bg: '#ffffff',
        dpi: 300,
        uploads: { canonical: file_original_url },
        file_hash,
        price: { amount: priceAmount, currency: priceCurrency },
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
      const out = await submitJobApi(API_BASE, submitBody);
      const jobId = out?.job?.job_id || out?.job_id;
      await handleAfterSubmit(jobId);
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
              onChange={handleSizeChange}
              locked={material === 'Glasspad'}
            />
            <Calculadora
              width={Number(size.w)}
              height={Number(size.h)}
              material={material}
              setPrice={setPriceAmount}
            />
          </>
        )}
      </div>

      <div className={styles.main}>
        <UploadStep onUploaded={file => { setUploaded(file); setAckLow(false); }} />

        <EditorCanvas
          ref={canvasRef}
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
          <button className={styles.continueButton} disabled={busy || priceAmount <= 0} onClick={handleContinue}>
            Continuar
          </button>
        )}

        {err && <p className={`errorText ${styles.error}`}>{err}</p>}
      </div>
      <LoadingOverlay show={busy} messages={["Creando tu pedido…"]} />
    </div>
  );
}
