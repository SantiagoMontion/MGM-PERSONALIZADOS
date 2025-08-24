// src/pages/Home.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import UploadStep from '../components/UploadStep';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';
import LoadingOverlay from '../components/LoadingOverlay';
import Modal from '../components/Modal';

import { dpiLevel } from '../lib/dpi';
import styles from './Home.module.css';
import { buildSubmitJobBody, prevalidateSubmitBody } from '../lib/jobPayload';
import { submitJob as submitJobApi } from '../lib/submitJob';

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
  const [designName, setDesignName] = useState('');
  const [ackLow, setAckLow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  function handleContinue() {
    if (!uploaded || !layout) return;
    if (!designName.trim()) {
      setErr('Falta el nombre del modelo');
      return;
    }
    setConfirmOpen(true);
  }

 async function submitJob() {
  try {
    const submitBody = buildSubmitJobBody({
      material: state.material,
      size: { w: state.widthCm, h: state.heightCm, bleed_mm: 3 },
      fit_mode: state.mode, // 'cover'|'contain'|'stretch'
      bg: state.bg || '#ffffff',
      dpi: state.dpi || 300,
      uploads: {
        signed_url: state?.upload?.signed_url,
        object_key: state?.upload?.object_key,
        canonical: state?.file_original_url,
      },
      file_hash: state?.file_hash,
      price: { amount: 45900, currency: 'ARS' },
      customer: { email: state?.email, name: state?.name },
      notes: state?.notes || '',
      source: 'web',
    });

    const pre = prevalidateSubmitBody(submitBody);
    console.log('[PREVALIDATE Home]', pre, submitBody);
    if (!pre.ok) {
      alert(pre.problems.join('\n'));
      return;
    }

    const apiBase = import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app';
    const job = await submitJobApi(apiBase, submitBody);

    // segui con tu flujo…
    navigate(`/confirm/${job.job_id}`);
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
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

      <Modal
        open={confirmOpen}
        title="¿La imagen está editada completamente y no realizarás más cambios?"
        actions={[
          { label: 'Cancelar', onClick: () => setConfirmOpen(false) },
          { label: 'Enviar', onClick: submitJob }
        ]}
      />

      <LoadingOverlay
        show={busy}
        messages={['Llamando a la api por teléfono', 'Cargando el último pixel']}
      />
    </div>
  );
}
