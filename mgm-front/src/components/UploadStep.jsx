// src/components/UploadStep.jsx
import { useRef, useState, useEffect } from 'react';
import styles from './UploadStep.module.css';
import LoadingOverlay from './LoadingOverlay';
import { dlog } from '../lib/debug';

export default function UploadStep({ onUploaded }) {
  const inputRef = useRef(null);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => { onUploadedRef.current = onUploaded; }, [onUploaded]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [file, setFile] = useState(null);
  const phrases = ['Mejorando últimos ajustes', 'Cargando el último pixel'];

  const openPicker = () => {
    setErr('');
    inputRef.current?.click();
  };

  function handlePicked(e) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setBusy(true);
    setErr('');
    setFile(picked);
    if (inputRef.current) inputRef.current.value = '';
  }

  useEffect(() => {
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    const uploaded = { file, localUrl };
    dlog('[UploadStep] local-only', uploaded);
    try {
      onUploadedRef.current?.(uploaded);
    } catch (e) {
      console.error(e);
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
    return () => URL.revokeObjectURL(localUrl);
  }, [file]);

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