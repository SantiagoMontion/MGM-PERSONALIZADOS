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

function toHttpUrl(raw) {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value) return '';
  try {
    if (/^\/\//.test(value)) {
      return `https:${value}`;
    }
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    if (/^[-a-zA-Z0-9.]+\//.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) {
      return `https://${value.replace(/^\/+/, '')}`;
    }
    const parsed = new URL(value, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function useBridgeWatcher(rid) {
  const [timedOut, setTimedOut] = useState(false);
  const [readyUrl, setReadyUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (!rid) return undefined;

    const key = `bridge:${rid}`;
    let cancelled = false;
    let intervalId = null;

    const stopPolling = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const tryResolve = () => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return;
        const data = JSON.parse(raw);
        const status = typeof data?.status === 'string' ? data.status.trim().toLowerCase() : '';
        const url = toHttpUrl(typeof data?.url === 'string' ? data.url : '');
        const maybeError = typeof data?.error === 'string' && data.error.trim()
          ? data.error.trim()
          : 'Hubo un problema al generar tu carrito.';

        if (status === 'error') {
          stopPolling();
          setErrorMessage(maybeError);
          return;
        }

        if (status === 'ok' && url) {
          setReadyUrl(url);
          stopPolling();
          try {
            window.localStorage.removeItem(key);
          } catch {
            // noop
          }
          window.location.replace(url);
          return;
        }

        if (url) {
          setReadyUrl(url);
        }
      } catch (err) {
        console.error('[bridge] navigation failed', err);
      }
    };

    const onStorage = (event) => {
      if (event?.key === key) {
        tryResolve();
      }
    };

    window.addEventListener('storage', onStorage);
    intervalId = window.setInterval(tryResolve, 500);
    const timeoutId = window.setTimeout(() => setTimedOut(true), 90_000);
    const fallbackId = window.setTimeout(() => setShowFallback(true), 15_000);

    tryResolve();

    return () => {
      cancelled = true;
      stopPolling();
      window.removeEventListener('storage', onStorage);
      window.clearTimeout(timeoutId);
      window.clearTimeout(fallbackId);
    };
  }, [rid]);

  return {
    timedOut,
    readyUrl,
    errorMessage,
    showFallback,
  };
}

export default function Bridge() {
  const rid = useRid();
  const {
    timedOut,
    readyUrl,
    errorMessage,
    showFallback,
  } = useBridgeWatcher(rid);

  const showError = Boolean(errorMessage);

  const buttonBaseStyle = {
    marginTop: 24,
    padding: '12px 20px',
    borderRadius: 8,
    border: 'none',
    background: '#ffffff',
    color: '#181818',
    fontSize: 16,
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  };

  const goBackToEditor = () => {
    try {
      window.close();
    } catch {
      // noop
    }
    window.location.assign('/mockup');
  };

  return (
    <div
      style={{
        height: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: '#181818',
        color: '#fff',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div>
        {!showError ? (
          <>
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
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 34, margin: 0 }}>Hubo un problema al generar tu carrito</h1>
            <p style={{ opacity: 0.9, marginTop: 12 }}>{errorMessage}</p>
            <button
              type="button"
              onClick={goBackToEditor}
              style={buttonBaseStyle}
            >
              Cerrar y volver al editor
            </button>
          </>
        )}

        {!showError && showFallback && readyUrl ? (
          <a
            href={readyUrl}
            style={buttonBaseStyle}
          >
            ¿No fuiste redirigido? Haz clic aquí para ir al checkout
          </a>
        ) : null}

        {!showError && timedOut ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={buttonBaseStyle}
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
      <style>
        {`@keyframes spin { to { transform: rotate(360deg); } }`}
      </style>
    </div>
  );
}
