// src/components/UploadStep.jsx
import { useRef, useState, useEffect } from 'react';
import styles from './UploadStep.module.css';
import LoadingOverlay from './LoadingOverlay';
import { quickPass, deepPass, MODERATION } from '../lib/moderation';

export default function UploadStep({ onUploaded }) {
  const inputRef = useRef(null);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => { onUploadedRef.current = onUploaded; }, [onUploaded]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [moderationState, setModerationState] = useState(null); // null|quick|deep

  const openPicker = () => {
    setErr('');
    inputRef.current?.click();
  };

  async function handlePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (inputRef.current) inputRef.current.value = '';
    setErr('');
    setBusy(true);
    let allow = false;
    try {
      setModerationState('quick');
      const q = await quickPass(file, { filename: file.name });
      if (!q.escalate) {
        allow = true;
      } else {
        setModerationState('deep');
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort('timeout'), MODERATION.deep.maxMs);
        try {
          const r = await deepPass(file, ac.signal);
          allow = !!r.allow;
          if (!r.allow) setErr('Bloqueada por política: ' + (r.reason || 'Contenido no permitido'));
        } catch {
          allow = true; // prefer allow on failure
        } finally {
          clearTimeout(t);
        }
      }
    } catch (e) {
      console.error(e);
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
      setModerationState(null);
    }
    if (allow) {
      const localUrl = URL.createObjectURL(file);
      onUploadedRef.current?.({ file, localUrl });
    }
  }

  return (
    <div className={styles.container}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png, image/jpeg, image/webp"
        className={styles.hiddenInput}
        onChange={handlePicked}
      />
      <button onClick={openPicker} disabled={busy}>
        {busy ? 'Procesando…' : 'Subir imagen'}
      </button>

      <LoadingOverlay show={moderationState === 'deep'} messages={[ 'Chequeo adicional…' ]} />

      {err && (
        <p className={`errorText ${styles.error}`}>
          {err}
        </p>
      )}
    </div>
  );
}
