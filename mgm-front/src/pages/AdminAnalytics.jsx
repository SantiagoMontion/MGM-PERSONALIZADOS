import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './AdminAnalytics.module.css';

const REFRESH_INTERVAL_MS = 60000;
const RANGE_DAYS = 30;
const RANGE_MS = RANGE_DAYS * 24 * 60 * 60 * 1000;

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0';
  }
  return value.toLocaleString('es-AR');
}

function formatPercentage(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0%';
  }
  return `${value.toFixed(2)}%`;
}

function formatWindowDate(value) {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return '';
  }
  return parsed.toLocaleString();
}

export default function AdminAnalytics() {
  const [token, setToken] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    try {
      return window.localStorage.getItem('adminToken') || '';
    } catch (err) {
      console.warn('[admin-analytics] localStorage_get_failed', err);
      return '';
    }
  });
  const [formToken, setFormToken] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const rawBase = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL : '';
  const sanitizedBase = rawBase.trim().replace(/\/+$/, '');
  const apiBase = sanitizedBase || '/api';
  const analyticsEndpoint = useMemo(() => `${apiBase}/analytics/flows`, [apiBase]);

  const handleLogout = useCallback((options = {}) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('adminToken');
      } catch (err) {
        console.warn('[admin-analytics] localStorage_remove_failed', err);
      }
    }
    setToken('');
    setData(null);
    setLastUpdated(null);
    if (!options.preserveError) {
      setError('');
    }
    if (!options.preserveForm) {
      setFormToken('');
    }
    setIsLoading(false);
  }, []);

  const fetchAnalytics = useCallback(async (currentToken) => {
    if (!currentToken) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const now = new Date();
      const toIso = now.toISOString();
      const fromIso = new Date(now.getTime() - RANGE_MS).toISOString();
      const url = `${analyticsEndpoint}?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Admin-Token': currentToken,
        },
      });

      if (response.status === 401) {
        setError('Token inválido');
        handleLogout({ preserveError: true });
        return;
      }

      const text = await response.text();
      const json = text ? JSON.parse(text) : null;

      if (!response.ok || !json?.ok) {
        const message = typeof json?.error === 'string' && json.error
          ? json.error
          : 'No se pudieron cargar las métricas. Intentá nuevamente.';
        setError(message);
        if (!json?.ok) {
          setData(null);
        }
        return;
      }

      setData(json);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[admin-analytics] fetch_failed', err);
      setError('No se pudieron cargar las métricas. Intentá nuevamente.');
    } finally {
      setIsLoading(false);
    }
  }, [analyticsEndpoint, handleLogout]);

  useEffect(() => {
    if (!token) {
      setData(null);
      setLastUpdated(null);
      return undefined;
    }

    let cancelled = false;
    let isFetching = false;

    const load = async () => {
      if (cancelled || isFetching) {
        return;
      }
      isFetching = true;
      try {
        await fetchAnalytics(token);
      } finally {
        isFetching = false;
      }
    };

    load();
    const intervalId = window.setInterval(load, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [token, fetchAnalytics]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const value = formToken.trim();
    if (!value) {
      setError('Ingresá el token de administrador.');
      return;
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('adminToken', value);
      } catch (err) {
        console.warn('[admin-analytics] localStorage_set_failed', err);
      }
    }
    setToken(value);
    setFormToken('');
    setError('');
  };

  const handleRefresh = useCallback(() => {
    if (token) {
      fetchAnalytics(token);
    }
  }, [token, fetchAnalytics]);

  const totals = data?.ok ? data.totals : null;
  const topDesigns = data?.ok && Array.isArray(data.topDesigns) ? data.topDesigns : [];
  const windowFrom = data?.ok ? formatWindowDate(data.window?.from) : '';
  const windowTo = data?.ok ? formatWindowDate(data.window?.to) : '';

  if (!token) {
    return (
      <div className={styles.loginCard}>
        <h1 className={styles.loginTitle}>Panel de Analytics</h1>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <label className={styles.loginLabel}>
            Token de administrador
            <input
              type="password"
              className={styles.loginInput}
              value={formToken}
              onChange={(event) => setFormToken(event.target.value)}
              placeholder="Ingresá tu token"
              autoFocus
            />
          </label>
          <button type="submit" className={styles.loginButton}>
            Entrar
          </button>
        </form>
        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.loginHint}>Ingresá el token de administrador para ver las métricas.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Analytics de flujos</h1>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.secondaryButton}`}
            onClick={handleRefresh}
            disabled={isLoading}
          >
            Actualizar
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => handleLogout()}
          >
            Salir
          </button>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {isLoading && <p className={styles.status}>Cargando métricas…</p>}

      {totals && (
        <section>
          <div className={styles.cards}>
            {[
              { key: 'public', label: 'Public', data: totals.public },
              { key: 'private', label: 'Private', data: totals.private },
              { key: 'cart', label: 'Cart', data: totals.cart },
            ].map(({ key, label, data: cardData }) => (
              <article key={key} className={styles.card}>
                <span className={styles.cardTitle}>{label}</span>
                <p className={styles.cardMetric}>{formatNumber(cardData?.clicks ?? 0)}</p>
                <span className={styles.cardSubmetric}>
                  Compradores: {formatNumber(cardData?.purchasers ?? 0)} · Conversión: {formatPercentage(cardData?.rate ?? 0)}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className={styles.metaRow}>
        {lastUpdated && <span>Última actualización: {lastUpdated.toLocaleString()}</span>}
        {windowFrom && windowTo && <span>Ventana: {windowFrom} → {windowTo}</span>}
      </div>

      <section className={styles.tableWrapper}>
        <h2 className={styles.sectionTitle}>Top diseños (clicks)</h2>
        {topDesigns.length ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Slug</th>
                <th>Clicks</th>
              </tr>
            </thead>
            <tbody>
              {topDesigns.map((design) => (
                <tr key={design.design_slug}>
                  <td>{design.design_slug}</td>
                  <td>{formatNumber(design.clicks ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.emptyState}>Todavía no hay datos de diseños destacados.</p>
        )}
      </section>
    </div>
  );
}
