// src/pages/Home.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import UploadStep from '../components/UploadStep';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';
import { api } from '../lib/api';
import { dpiLevel } from '../lib/dpi';

export default function Home() {
  const navigate = useNavigate();

  // archivo subido
  const [uploaded, setUploaded] = useState(null);

  // crear ObjectURL una sola vez
  const [imageUrl, setImageUrl] = useState(null);
  useEffect(() => {
    if (uploaded?.file) {
      const url = URL.createObjectURL(uploaded.file);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setImageUrl(null);
    }
  }, [uploaded?.file]);

  // medidas y material (source of truth)
  const [material, setMaterial] = useState('Classic');
  const [mode, setMode] = useState('standard');
  const [size, setSize] = useState({ w: 90, h: 40 });
  const sizeCm = useMemo(() => ({ w: Number(size.w) || 90, h: Number(size.h) || 40 }), [size.w, size.h]);

  // layout del canvas
  const [layout, setLayout] = useState(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function handleContinue() {
    if (!uploaded || !layout) return;
    setBusy(true);
    setErr('');
    try {
      const effDpi = Math.round(
        Math.min(
          layout.dpi / Math.max(1e-6, layout.transform.scaleX),
          layout.dpi / Math.max(1e-6, layout.transform.scaleY)
        )
      );
      const level = dpiLevel(effDpi, 300, 100);

      const body = {
        material,
        size_cm: { w: sizeCm.w, h: sizeCm.h, bleed_mm: 3 },
        fit_mode: layout.mode,
        bg: layout.background,
        file_original_url: uploaded.file_original_url,
        file_hash: uploaded.file_hash,
        dpi_report: { dpi: effDpi, level, customer_ack: false },
        notes: '',
        price: { currency: 'ARS', amount: 0 },
        source: 'web',
        layout,
      };

      const res = await api('/api/submit-job', {
        method: 'POST',
        headers: { 'Idempotency-Key': nanoid() },
        body: JSON.stringify(body),
      });

      navigate(`/confirm?job_id=${res.job_id}`);
    } catch (e) {
      setErr(String(e?.body?.error || e?.message || e));
    } finally {
      setBusy(false);
    }
  }


  return (
    <div>
      <h1>Mousepad Personalizado</h1>

      <UploadStep onUploaded={setUploaded} />

      {uploaded && (
        <>
          {/* Form de medida/material */}
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

          {/* Editor (solo canvas) */}
          <EditorCanvas
            imageUrl={imageUrl}
            sizeCm={sizeCm}       // 👈 que no falte
            bleedMm={3}
            dpi={300}
            onLayoutChange={setLayout}
          />

          <button style={{ marginTop: 12 }} disabled={busy} onClick={handleContinue}>
            {busy ? 'Enviando…' : 'Continuar'}
          </button>
          {err && <p style={{ color: 'crimson', marginTop: 6 }}>{err}</p>}
        </>
      )}
    </div>
  );
}

