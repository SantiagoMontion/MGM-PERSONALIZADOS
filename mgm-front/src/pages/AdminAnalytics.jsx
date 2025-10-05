import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './AdminAnalytics.module.css';

const REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_RANGE_DAYS = 30;
const RANGE_OPTIONS = [7, 14, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

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

const rawApiBase = typeof import.meta.env.VITE_API_BASE === 'string'
  ? import.meta.env.VITE_API_BASE
  : typeof import.meta.env.VITE_API_URL === 'string'
    ? import.meta.env.VITE_API_URL
    : '';
const sanitizedApiBase = rawApiBase.trim().replace(/\/+$/, '');
const apiBase = sanitizedApiBase || '/api';
const adminToken = typeof import.meta.env.VITE_ADMIN_ANALYTICS_TOKEN === 'string'
  ? import.meta.env.VITE_ADMIN_ANALYTICS_TOKEN.trim()
  : '';

export default function AdminAnalyticsPage() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rangeDays, setRangeDays] = useState(DEFAULT_RANGE_DAYS);
  const [funnel, setFunnel] = useState(null);
  const [funnelError, setFunnelError] = useState('');
  const [isFunnelLoading, setIsFunnelLoading] = useState(false);
  const [lastEvents, setLastEvents] = useState([]);
  const [lastEventsError, setLastEventsError] = useState('');
  const [isLastEventsLoading, setIsLastEventsLoading] = useState(false);

  const analyticsEndpoint = useMemo(() => `${apiBase}/analytics/flows`, []);
  const funnelEndpoint = useMemo(() => `${apiBase}/analytics/funnel`, []);
  const lastEventsEndpoint = useMemo(() => `${apiBase}/analytics/last-events`, []);

  const buildWindowRange = useCallback(() => {
    const now = new Date();
    const toIso = now.toISOString();
    const fromIso = new Date(now.getTime() - rangeDays * DAY_MS).toISOString();
    return { fromIso, toIso };
  }, [rangeDays]);

  const fetchAnalytics = useCallback(async (windowRange) => {
    if (!adminToken) {
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
          'X-Admin-Token': adminToken,
        },
      });

      const text = await response.text();
      const json = text ? JSON.parse(text) : null;

      if (response.status === 401) {
        setError('Token inválido');
        setMetrics(null);
        return;
      }

      if (!response.ok || !json?.ok) {
        const message = typeof json?.error === 'string' && json.error
          ? json.error
          : 'analytics_failed';
        setError(message);
        setMetrics(null);
        return;
      }

      setMetrics(json);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[admin-analytics] fetch_failed', err);
      setError('analytics_failed');
      setMetrics(null);
    } finally {
      setIsLoading(false);
    }
  }, [adminToken, analyticsEndpoint]);

  const fetchFunnel = useCallback(async (windowRange) => {
    if (!adminToken) {
      return;
    }

    setIsFunnelLoading(true);
    setFunnelError('');

    try {
      const fromIso = windowRange?.fromIso ?? '';
      const toIso = windowRange?.toIso ?? '';
      const url = `${funnelEndpoint}?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Admin-Token': adminToken,
        },
      });

      const text = await response.text();
      const json = text ? JSON.parse(text) : null;

      if (response.status === 401) {
        setFunnelError('Token inválido');
        setFunnel(null);
        return;
      }

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
  }, [adminToken, funnelEndpoint]);

  const fetchLastEvents = useCallback(async () => {
    if (!adminToken) {
      return;
    }

    setIsLastEventsLoading(true);
    setLastEventsError('');

    try {
      const response = await fetch(`${lastEventsEndpoint}?limit=50`, {
        headers: {
          Accept: 'application/json',
          'X-Admin-Token': adminToken,
        },
      });

      const text = await response.text();
      const json = text ? JSON.parse(text) : null;

      if (response.status === 401) {
        setLastEventsError('Token inválido');
        setLastEvents([]);
        return;
      }

      if (!response.ok || !json?.ok) {
        throw new Error('invalid_response');
      }

      setLastEvents(Array.isArray(json.events) ? json.events : []);
      setLastEventsError('');
    } catch (err) {
      console.error('[admin-analytics] fetch_last_events_failed', err);
      setLastEvents([]);
      setLastEventsError('No se pudieron cargar los eventos recientes.');
    } finally {
      setIsLastEventsLoading(false);
    }
  }, [adminToken, lastEventsEndpoint]);

  const loadAll = useCallback(async () => {
    if (!adminToken) {
      return;
    }

    const windowRange = buildWindowRange();
    await Promise.all([
      fetchAnalytics(windowRange),
      fetchFunnel(windowRange),
      fetchLastEvents(),
    ]);
  }, [adminToken, buildWindowRange, fetchAnalytics, fetchFunnel, fetchLastEvents]);

  useEffect(() => {
    if (!adminToken) {
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
  }, [adminToken, loadAll]);

  const handleRefresh = useCallback(() => {
    if (adminToken) {
      loadAll();
    }
  }, [adminToken, loadAll]);

  const handleRangeChange = (event) => {
    const value = Number(event.target.value);
    if (Number.isNaN(value) || value === rangeDays) {
      return;
    }
    setRangeDays(value);
    setMetrics(null);
    setError('');
    setFunnel(null);
    setFunnelError('');
    setLastEvents([]);
    setLastEventsError('');
  };

  const handleRetryMetrics = useCallback(() => {
    if (!adminToken) {
      return;
    }
    const windowRange = buildWindowRange();
    fetchAnalytics(windowRange);
  }, [adminToken, buildWindowRange, fetchAnalytics]);

  const handleRetryFunnel = useCallback(() => {
    if (!adminToken) {
      return;
    }
    const windowRange = buildWindowRange();
    setFunnelError('');
    setFunnel(null);
    fetchFunnel(windowRange);
  }, [adminToken, buildWindowRange, fetchFunnel]);

  const handleRetryLastEvents = useCallback(() => {
    if (!adminToken) {
      return;
    }
    fetchLastEvents();
  }, [adminToken, fetchLastEvents]);

  if (!adminToken) {
    return (
      <div className={styles.loginCard}>
        <h1 className={styles.loginTitle}>Panel de Analytics</h1>
        <p className={styles.loginHint}>
          Configurá <code>VITE_ADMIN_ANALYTICS_TOKEN</code> para habilitar este panel.
        </p>
      </div>
    );
  }

  const totals = metrics?.ok ? metrics.totals ?? {} : {};
  const rates = metrics?.ok ? metrics.rates ?? {} : {};
  const ctas = metrics?.ok ? metrics.ctas ?? {} : {};
  const topDesigns = metrics?.ok && Array.isArray(metrics.topDesigns) ? metrics.topDesigns : [];
  const windowFrom = metrics?.ok ? formatWindowDate(metrics.from) : '';
  const windowTo = metrics?.ok ? formatWindowDate(metrics.to) : '';
  const showLoadingState = isLoading && !metrics && !error;
  const showFunnelSkeleton = funnel === null && !funnelError && isFunnelLoading;

  const stageCards = [
    {
      key: 'view',
      label: 'Views',
      value: formatNumber(totals.view ?? 0),
      subtitle: null,
    },
    {
      key: 'options',
      label: 'Opciones',
      value: formatNumber(totals.options ?? 0),
      subtitle: `View → Options: ${formatPercentage(rates.view_to_options ?? 0)}`,
    },
    {
      key: 'clicks',
      label: 'Clicks CTA',
      value: formatNumber(totals.clicks ?? 0),
      subtitle: `Options → Clicks: ${formatPercentage(rates.options_to_clicks ?? 0)}`,
    },
    {
      key: 'purchase',
      label: 'Compras',
      value: formatNumber(totals.purchase ?? 0),
      subtitle: `Clicks → Purchase: ${formatPercentage(rates.clicks_to_purchase ?? 0)}`,
      extra: `View → Purchase: ${formatPercentage(rates.view_to_purchase ?? 0)}`,
    },
  ];

  const ctaRows = [
    { key: 'public', label: 'Public', data: ctas.public },
    { key: 'private', label: 'Private', data: ctas.private },
    { key: 'cart', label: 'Cart', data: ctas.cart },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Analytics de flujos</h1>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleRefresh}
            disabled={isLoading}
          >
            Actualizar
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

      {error && (
        <div className={styles.inlineError}>
          <span>{error}</span>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleRetryMetrics}
            disabled={isLoading}
          >
            Reintentar
          </button>
        </div>
      )}

      {showLoadingState && <p className={styles.status}>Cargando métricas…</p>}

      {metrics?.ok && (
        <section>
          <div className={styles.cards}>
            {stageCards.map(({ key, label, value, subtitle, extra }) => (
              <article key={key} className={styles.card}>
                <span className={styles.cardTitle}>{label}</span>
                <p className={styles.cardMetric}>{value}</p>
                {subtitle && <span className={styles.cardSubmetric}>{subtitle}</span>}
                {extra && <span className={styles.cardSubmetric}>{extra}</span>}
              </article>
            ))}
          </div>

          <div className={styles.cards}>
            {ctaRows.map(({ key, label, data }) => (
              <article key={key} className={styles.card}>
                <span className={styles.cardTitle}>{label}</span>
                <p className={styles.cardMetric}>{formatNumber(data?.clicks ?? 0)}</p>
                <span className={styles.cardSubmetric}>
                  Compradores: {formatNumber(data?.purchases ?? 0)} · Conversión:{' '}
                  {formatPercentage(data?.rate ?? 0)}
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
                value: formatNumber(funnel?.stages?.view?.rids ?? 0),
                subtitle: null,
              }, {
                key: 'options',
                label: 'Options',
                value: formatNumber(funnel?.stages?.options?.rids ?? 0),
                subtitle: `View → Options: ${formatPercentage(funnel?.stages?.options?.rate_from_view ?? 0)}`,
              }, {
                key: 'clicks',
                label: 'Clicks',
                value: formatNumber(funnel?.stages?.clicks?.rids ?? 0),
                subtitle: `Options → Clicks: ${formatPercentage(funnel?.stages?.clicks?.rate_from_options ?? 0)}`,
              }, {
                key: 'purchase',
                label: 'Purchase',
                value: formatNumber(funnel?.stages?.purchase?.rids ?? 0),
                subtitle: `Clicks → Purchase: ${formatPercentage(funnel?.stages?.purchase?.rate_from_clicks ?? 0)}`,
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
                  {ctaRows.map(({ key, label, data }) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>{formatNumber(data?.clicks ?? 0)}</td>
                      <td>{formatNumber(data?.purchases ?? data?.purchasers ?? 0)}</td>
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

      <section className={styles.tableWrapper}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Últimos eventos</h2>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleRetryLastEvents}
            disabled={isLastEventsLoading}
          >
            Refrescar
          </button>
        </div>

        {lastEventsError && <p className={styles.error}>{lastEventsError}</p>}
        {isLastEventsLoading && !lastEventsError && <p className={styles.status}>Cargando eventos…</p>}

        {lastEvents.length ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>RID</th>
                <th>Evento</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {lastEvents.map((event) => (
                <tr key={`${event.rid}-${event.created_at}-${event.event_name}`}>
                  <td>{event.rid || '—'}</td>
                  <td>{event.event_name || '—'}</td>
                  <td>{formatWindowDate(event.created_at) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (!isLastEventsLoading && !lastEventsError ? (
          <p className={styles.emptyState}>Sin eventos recientes.</p>
        ) : null)}
      </section>
    </div>
  );
}
