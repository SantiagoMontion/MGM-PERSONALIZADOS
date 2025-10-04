import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './AdminAnalytics.module.css';

const REFRESH_INTERVAL_MS = 60000;
const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_OPTIONS = [7, 14, 30];

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

export default function AdminAnalyticsPage() {
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
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rangeDays, setRangeDays] = useState(DEFAULT_RANGE_DAYS);
  const [funnel, setFunnel] = useState(null);
  const [funnelError, setFunnelError] = useState('');
  const [isFunnelLoading, setIsFunnelLoading] = useState(false);

  const rawBase = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL : '';
  const sanitizedBase = rawBase.trim().replace(/\/+$/, '');
  const apiBase = sanitizedBase || '/api';
  const analyticsEndpoint = useMemo(() => `${apiBase}/analytics/flows`, [apiBase]);
  const funnelEndpoint = useMemo(() => `${apiBase}/analytics/funnel`, [apiBase]);

  const buildWindowRange = useCallback(() => {
    const now = new Date();
    const toIso = now.toISOString();
    const fromIso = new Date(now.getTime() - rangeDays * DAY_MS).toISOString();
    return { fromIso, toIso };
  }, [rangeDays]);

  const handleLogout = useCallback((options = {}) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('adminToken');
      } catch (err) {
        console.warn('[admin-analytics] localStorage_remove_failed', err);
      }
    }
    setToken('');
    setMetrics(null);
    setLastUpdated(null);
    setFunnel(null);
    if (!options.preserveError) {
      setError('');
      setFunnelError('');
    }
    if (!options.preserveForm) {
      setFormToken('');
    }
    setIsLoading(false);
    setIsFunnelLoading(false);
  }, []);

  const fetchAnalytics = useCallback(async (currentToken, windowRange) => {
    if (!currentToken) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const fromIso = windowRange?.fromIso ?? '';
      const toIso = windowRange?.toIso ?? '';
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
          setMetrics(null);
        }
        return;
      }

      setMetrics(json);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[admin-analytics] fetch_failed', err);
      setError('No se pudieron cargar las métricas. Intentá nuevamente.');
    } finally {
      setIsLoading(false);
    }
  }, [analyticsEndpoint, handleLogout]);

  const fetchFunnel = useCallback(async (currentToken, windowRange) => {
    if (!currentToken) {
      return;
    }

    setIsFunnelLoading(true);

    try {
      const fromIso = windowRange?.fromIso ?? '';
      const toIso = windowRange?.toIso ?? '';
      const url = `${funnelEndpoint}?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Admin-Token': currentToken,
        },
      });

      if (response.status === 401) {
        setFunnelError('Token inválido');
        handleLogout({ preserveError: true });
        return;
      }

      const text = await response.text();
      const json = text ? JSON.parse(text) : null;

      if (!response.ok || !json) {
        throw new Error('invalid_response');
      }

      setFunnel(json);
      if (json.ok === false) {
        setFunnelError('Sin datos / ventana vacía');
      } else {
        setFunnelError('');
      }
    } catch (err) {
      console.error('[admin-analytics] fetch_funnel_failed', err);
      setFunnel(null);
      setFunnelError('No se pudo cargar el funnel. Intentá nuevamente.');
    } finally {
      setIsFunnelLoading(false);
    }
  }, [funnelEndpoint, handleLogout]);

  const loadAll = useCallback(async () => {
    if (!token) {
      return;
    }

    const windowRange = buildWindowRange();
    await Promise.all([
      fetchAnalytics(token, windowRange),
      fetchFunnel(token, windowRange),
    ]);
  }, [token, buildWindowRange, fetchAnalytics, fetchFunnel]);

  useEffect(() => {
    if (!token) {
      setMetrics(null);
      setLastUpdated(null);
      setFunnel(null);
      setFunnelError('');
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
        await loadAll();
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
  }, [token, loadAll]);

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
      loadAll();
    }
  }, [token, loadAll]);

  const handleRangeChange = (event) => {
    const value = Number(event.target.value);
    if (Number.isNaN(value) || value === rangeDays) {
      return;
    }
    setRangeDays(value);
    setFunnel(null);
    setFunnelError('');
  };

  const handleRetryFunnel = useCallback(() => {
    if (!token) {
      return;
    }
    const windowRange = buildWindowRange();
    setFunnelError('');
    setFunnel(null);
    fetchFunnel(token, windowRange);
  }, [token, buildWindowRange, fetchFunnel]);

  const totals = metrics?.ok ? metrics.totals : null;
  const topDesigns = metrics?.ok && Array.isArray(metrics.topDesigns) ? metrics.topDesigns : [];
  const windowFrom = metrics?.ok ? formatWindowDate(metrics.window?.from) : '';
  const windowTo = metrics?.ok ? formatWindowDate(metrics.window?.to) : '';
  const isAwaitingMetrics = token && metrics === null;
  const showLoadingState = (isLoading || isAwaitingMetrics) && !error;
  const showFunnelSkeleton = funnel === null && !funnelError;
  const funnelStages = funnel?.ok ? funnel.stages ?? {} : {};
  const funnelCta = funnel?.ok ? funnel.cta ?? {} : {};

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

      <div className={styles.filtersRow}>
        <label className={styles.rangeLabel} htmlFor="admin-analytics-range">
          Rango de fechas
          <select
            id="admin-analytics-range"
            className={styles.rangeSelect}
            value={rangeDays}
            onChange={handleRangeChange}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                Últimos {option} días
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {showLoadingState && <p className={styles.status}>Cargando métricas…</p>}

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

      <section className={styles.funnelSection}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Funnel</h2>
          <span className={styles.sectionSubtitle}>/mockup → opciones → clic → compra</span>
        </div>

        {showFunnelSkeleton && <p className={styles.status}>Cargando funnel…</p>}

        {funnelError && (
          <div className={styles.inlineError}>
            <span>{funnelError}</span>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleRetryFunnel}
              disabled={isFunnelLoading}
            >
              Reintentar
            </button>
          </div>
        )}

        {funnel?.ok && (
          <>
            <div className={styles.cards}>
              {[{
                key: 'view',
                label: 'View',
                value: formatNumber(funnelStages?.view?.rids ?? 0),
                subtitle: null,
              }, {
                key: 'continue',
                label: 'Continue',
                value: formatNumber(funnelStages?.continue?.rids ?? 0),
                subtitle: `Conversión desde View: ${formatPercentage(funnelStages?.continue?.rate_from_view ?? 0)}`,
              }, {
                key: 'options',
                label: 'Options',
                value: formatNumber(funnelStages?.options?.rids ?? 0),
                subtitle: `Conversión desde Continue: ${formatPercentage(funnelStages?.options?.rate_from_continue ?? 0)}`,
              }, {
                key: 'clicks',
                label: 'Clicks',
                value: formatNumber(funnelStages?.clicks?.rids ?? 0),
                subtitle: `Conversión desde Options: ${formatPercentage(funnelStages?.clicks?.rate_from_options ?? 0)}`,
              }, {
                key: 'purchase',
                label: 'Purchase',
                value: formatNumber(funnelStages?.purchase?.rids ?? 0),
                subtitle: `Conversión desde Clicks: ${formatPercentage(funnelStages?.purchase?.rate_from_clicks ?? 0)}`,
              }].map(({ key, label, value, subtitle }) => (
                <article key={key} className={styles.card}>
                  <span className={styles.cardTitle}>{label}</span>
                  <p className={styles.cardMetric}>{value}</p>
                  {subtitle && <span className={styles.cardSubmetric}>{subtitle}</span>}
                </article>
              ))}
            </div>

            <div className={styles.tableWrapper}>
              <h3 className={styles.sectionTitle}>CTA</h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Clicks</th>
                    <th>Compradores</th>
                    <th>Conversión</th>
                  </tr>
                </thead>
                <tbody>
                  {[{
                    key: 'public',
                    label: 'Public',
                    data: funnelCta.public,
                  }, {
                    key: 'private',
                    label: 'Private',
                    data: funnelCta.private,
                  }, {
                    key: 'cart',
                    label: 'Cart',
                    data: funnelCta.cart,
                  }].map(({ key, label, data }) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>{formatNumber(data?.clicks ?? 0)}</td>
                      <td>{formatNumber(data?.purchasers ?? 0)}</td>
                      <td>{formatPercentage(data?.rate ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

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
