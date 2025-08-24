// src/components/UploadStep.jsx
import { useRef, useState } from 'react';
import styles from './UploadStep.module.css';
import LoadingOverlay from './LoadingOverlay';
import { buildUploadsUrlFromObjectKey } from '../lib/jobPayload.js';

export default function UploadStep({ onUploaded }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const phrases = ['Mejorando últimos ajustes', 'Cargando el último pixel'];

  const openPicker = () => {
    setErr('');
    inputRef.current?.click();
  };

  async function sha256FromFile(file) {
    const buf = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function handlePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const file_hash = await sha256FromFile(file);
      const apiBase = (import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app').replace(/\/$/, '');
      const ext = file.name.split('.').pop()?.toLowerCase() || '';

      const r1 = await fetch(`${apiBase}/api/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ext,
          mime: file.type,
          size_bytes: file.size,
          material: 'Classic',
          w_cm: 10,
          h_cm: 10,
          sha256: file_hash,
        }),
      });
      const upResp = await r1.json();

      await fetch(upResp.upload.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      const supabaseBase = (import.meta.env.VITE_SUPABASE_URL || new URL(upResp.upload.signed_url).origin);
      const canonical = buildUploadsUrlFromObjectKey(supabaseBase, upResp.object_key);

      const uploaded = {
        file,
        upload: { signed_url: upResp.upload.signed_url },
        object_key: upResp.object_key,
        file_original_url: canonical,
        file_hash,
      };

      console.log('[UploadStep saved uploaded]', uploaded);
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