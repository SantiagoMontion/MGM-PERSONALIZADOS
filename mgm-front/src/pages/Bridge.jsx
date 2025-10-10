import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

function useRid() {
  const location = useLocation();
  return useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      const value = params.get('rid');
      return typeof value === 'string' && value.trim() ? value.trim() : '';
    } catch {
      return '';
    }
  }, [location.search]);
}

function useBridgeWatcher(rid) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!rid) return undefined;

    const key = ridge:;
    let cancelled = false;

    const tryNavigate = () => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return;
        const data = JSON.parse(raw);
        const url = typeof data?.url === 'string' ? data.url : '';
        if (url && /^https?:\/\//i.test(url)) {
          window.localStorage.removeItem(key);
          window.location.replace(url);
        }
      } catch (err) {
        console.error('[bridge] navigation failed', err);
      }
    };

    const onStorage = (event) => {
      if (event?.key === key && event.newValue) {
        tryNavigate();
      }
    };

    window.addEventListener('storage', onStorage);
    const intervalId = window.setInterval(tryNavigate, 500);
    const timeoutId = window.setTimeout(() => setTimedOut(true), 90_000);

    tryNavigate();

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [rid]);

  return timedOut;
}

export default function Bridge() {
  const rid = useRid();
  const timedOut = useBridgeWatcher(rid);

  return (
    <div
      style={{
        height: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#181818',
        color: '#fff',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: '6px solid rgba(255,255,255,.25)',
            borderTopColor: '#fff',
            margin: '0 auto 18px',
            animation: 'spin 1s linear infinite',
          }}
        />
        <h1 style={{ fontSize: 40, margin: 0 }}>Estás siendo redirigido…</h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>Tu producto se está terminando de crear</p>
        {timedOut ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 24,
              padding: '12px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#ffffff',
              color: '#181818',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        ) : null}
        {!rid ? (
          <p style={{ marginTop: 16, color: '#ffaaaa' }}>
            Falta el identificador de redirección. Cerrá esta pestaña y volvé a intentarlo.
          </p>
        ) : null}
      </div>
      <style>{@keyframes spin{to{transform:rotate(360deg)}}}</style>
    </div>
  );
}
