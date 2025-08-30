// src/components/UploadStep.jsx
import { useRef, useState, useEffect } from 'react';
import styles from './UploadStep.module.css';
import LoadingOverlay from './LoadingOverlay';

const ENABLE_MOD = (import.meta.env.VITE_ENABLE_MODERATION ?? 'true') !== 'false';
const SHOW_SCORES = import.meta.env.VITE_SHOW_MOD_SCORES === 'true';
const API_BASE = (import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app').replace(/\/$/, '');

export default function UploadStep({ onUploaded }) {
  const inputRef = useRef(null);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => { onUploadedRef.current = onUploaded; }, [onUploaded]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [diag, setDiag] = useState('');
  const [scores, setScores] = useState(null);
  const [state, setState] = useState('idle'); // idle|local_ok|server_checking|blocked|allowed

  const openPicker = () => {
    setErr('');
    setDiag('');
    setScores(null);
    inputRef.current?.click();
  };

  async function handlePicked(e) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (inputRef.current) inputRef.current.value = '';
    setErr('');
    setDiag('');
    setScores(null);

    if (!ENABLE_MOD) {
      const localUrl = URL.createObjectURL(picked);
      onUploadedRef.current?.({ file: picked, localUrl });
      setState('allowed');
      return;
    }

    setBusy(true);
    try {
      const local = await runLocalModeration(picked);
      setScores(local.scores);
      if (local.state === 'blocked') {
        setState('blocked');
        setErr('Contenido bloqueado por desnudez real.');
        return;
      }
      if (local.state === 'allowed') {
        const localUrl = URL.createObjectURL(picked);
        onUploadedRef.current?.({ file: picked, localUrl });
        setState('allowed');
        return;
      }
      setState('server_checking');
      const server = await runServerModeration(picked);
      setScores(server.scores);
      setDiag(server.diag_id || '');
      if (!server.allow) {
        setState('blocked');
        setErr('Bloqueada por política: ' + (server.reasons || []).join(', '));
        return;
      }
      const localUrl = URL.createObjectURL(picked);
      onUploadedRef.current?.({ file: picked, localUrl });
      setState('allowed');
    } catch (e) {
      console.error(e);
      setErr(String(e?.message || e));
      setState('blocked');
    } finally {
      setBusy(false);
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
        {busy ? 'Procesando…' : 'Subir imagen'}
      </button>

      <LoadingOverlay show={busy} messages={[ 'Analizando imagen…' ]} />

      {err && (
        <p className={`errorText ${styles.error}`}>
          {err} {diag && <code>diag:{diag}</code>}
        </p>
      )}

      {SHOW_SCORES && scores && (
        <details>
          <summary>Más detalles</summary>
          <pre>{JSON.stringify(scores, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

async function runLocalModeration(file) {
  const thresholds = {
    porn: Number(import.meta.env.VITE_NUDITY_BLOCK || '0.85'),
    sexy: Number(import.meta.env.VITE_SEXY_BLOCK || '0.9'),
    anime: Number(import.meta.env.VITE_ANIME_ALLOW || '0.7'),
    pornForAnime: Number(import.meta.env.VITE_ANIME_PORN_MAX || '0.6'),
  };
  const tf = await import(/* @vite-ignore */ 'https://esm.sh/@tensorflow/tfjs');
  await tf.ready?.();
  const nsfw = await import(/* @vite-ignore */ 'https://esm.sh/nsfwjs');
  const model = await nsfw.load();
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    const max = Math.max(img.width, img.height);
    const scale = Math.min(1, 224 / max);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const preds = await model.classify(canvas);
    const get = cls => preds.find(p => p.className === cls)?.probability || 0;
    const scores = {
      Porn: get('Porn'),
      Sexy: get('Sexy'),
      Hentai: get('Hentai'),
      Drawing: get('Drawing'),
    };
    if (scores.Porn >= thresholds.porn || (scores.Sexy >= thresholds.sexy && (scores.Drawing + scores.Hentai) < 0.4)) {
      return { state: 'blocked', scores };
    }
    if ((scores.Hentai >= thresholds.anime || scores.Drawing >= thresholds.anime) && scores.Porn < thresholds.pornForAnime) {
      return { state: 'allowed', scores };
    }
    return { state: 'local_ok', scores };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function runServerModeration(file) {
  const thumb = await createThumbnail(file);
  const form = new FormData();
  form.append('image', thumb, 'thumb.jpg');
  const res = await fetch(`${API_BASE}/api/moderate-image`, {
    method: 'POST',
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || 'moderation_failed');
  return json;
}

async function createThumbnail(file) {
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const maxSide = Math.max(img.width, img.height);
  const scale = Math.min(1, 512 / maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve) => {
    canvas.toBlob(b => { URL.revokeObjectURL(url); resolve(b); }, 'image/jpeg', 0.8);
  });
}
