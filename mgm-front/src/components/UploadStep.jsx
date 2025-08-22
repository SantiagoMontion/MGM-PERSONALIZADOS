// src/components/UploadStep.jsx
import { useRef, useState } from 'react';
import { supa } from '../lib/supa';
import { api } from '../lib/api';
import LoadingOverlay from './LoadingOverlay';

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
      // deducir ext/mime
      const lower = file.name.toLowerCase();
      const ext = lower.endsWith('.png') ? 'png' : 'jpg';
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

      // hash SHA-256 para dedupe
      const buf = await file.arrayBuffer();
      const hashArr = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)));
      const file_hash = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');

      // 1) pedir URL firmada
      const sig = await api('/api/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          ext, mime,
          size_bytes: file.size,
          // placeholders mínimos
          material: 'Classic', w_cm: 90, h_cm: 40,
          sha256: file_hash
        })
      });

      // 2) subir a Supabase de una
      const { error } = await supa
        .storage
        .from('uploads')
        .uploadToSignedUrl(sig.object_key, sig.upload.token, file);

      if (error) throw new Error(error.message || 'upload_failed');

      // 3) construir URL privada estable
      const file_original_url =
        `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/private/uploads/${sig.object_key}`;

      onUploaded({
        file,
        file_original_url,
        object_key: sig.object_key,
        file_hash
      });
    } catch (e) {
      setErr(String(e?.body?.error || e?.message || e));
    } finally {
      setBusy(false);
      // limpiar value para permitir elegir el mismo archivo de nuevo si quiere
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div style={{marginBottom: 12}}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png, image/jpeg"
        style={{ display: 'none' }}
        onChange={handlePicked}
      />
      <button onClick={openPicker} disabled={busy}>
        {busy ? 'Subiendo…' : 'Subir imagen'}
      </button>

      <LoadingOverlay show={busy} messages={phrases} />
      
      {err && <p style={{color:'crimson', marginTop:6}}>{err}</p>}
    </div>
  );
}
