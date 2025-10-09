import logger from '../lib/logger';
// src/components/UploadStep.jsx
import { useRef, useState } from 'react';
import styles from './UploadStep.module.css';
import LoadingOverlay from './LoadingOverlay';

export default function UploadStep({ onUploaded, className = '', renderTrigger }) {
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
      onUploaded(uploaded);
    } catch (e) {
      logger.error(e);
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const triggerContent = typeof renderTrigger === 'function'
    ? renderTrigger({ openPicker, busy })
    : (
      <button type="button" onClick={openPicker} disabled={busy} className={styles.defaultTrigger}>
        {busy ? 'Subiendo…' : 'Subir imagen'}
      </button>
    );

  const containerClassName = [styles.container, className].filter(Boolean).join(' ');

  return (
    <div className={containerClassName}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png, image/jpeg"
        className={styles.hiddenInput}
        onChange={handlePicked}
      />
      {triggerContent}

      {busy && <LoadingOverlay show={busy} messages={phrases} />}

      {err && <p className={`errorText ${styles.error}`}>{err}</p>}
    </div>
  );
}