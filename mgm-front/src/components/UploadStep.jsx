// src/components/UploadStep.jsx
import { useRef, useState } from 'react';
import styles from './UploadStep.module.css';
import LoadingOverlay from './LoadingOverlay';
import { dlog } from '../lib/debug';

export default function UploadStep({ onUploaded }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const phrases = ['Mejorando últimos ajustes', 'Cargando el último pixel'];

  const openPicker = () => {
    setErr('');
    inputRef.current?.click();
  };

  async function handlePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const localUrl = URL.createObjectURL(file);
      const uploaded = { file, localUrl };
      dlog('[UploadStep] local-only', uploaded);
      onUploaded(uploaded);
    } catch (e) {
      console.error(e);
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={styles.container}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png, image/jpeg"
        className={styles.hiddenInput}
        onChange={handlePicked}
      />
      <button onClick={openPicker} disabled={busy}>
        {busy ? 'Subiendo…' : 'Subir imagen'}
      </button>

      <LoadingOverlay show={busy} messages={phrases} />

      {err && <p className={`errorText ${styles.error}`}>{err}</p>}
    </div>
  );
}