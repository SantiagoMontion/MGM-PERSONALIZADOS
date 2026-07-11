import { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  PRINTS_GATE_PASSWORD,
  createGateRecord,
  readStoredGate,
  storeGate,
  clearGate,
  isGateValid,
} from '@/lib/printsGate.js';
import busquedaStyles from './Busqueda.module.css';
import styles from './Analytics.module.css';

const REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_RANGE_DAYS = 30;
const RANGE_OPTIONS = [7, 14, 30, 90];
const DAY_MS = 24 * 60 * 60 * 1000;

const rawApiBase = typeof import.meta.env.VITE_API_BASE === 'string'
  ? import.meta.env.VITE_API_BASE
  : typeof import.meta.env.VITE_API_URL === 'string'
    ? import.meta.env.VITE_API_URL
    : '';
const sanitizedApiBase = rawApiBase.trim().replace(/\/+$/, '');
const dashboardEndpoint = sanitizedApiBase
  ? `${sanitizedApiBase}/analytics/dashboard`
  : '/api/analytics/dashboard';

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0';
  return value.toLocaleString('es-AR');
}

function formatPercentage(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0%';
  return `${value.toFixed(1)}%`;
}

function formatWindowDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return '';
  return parsed.toLocaleString('es-AR');
}

function formatShortDate(value) {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

const FUNNEL_ORDER = ['visit', 'upload', 'edit', 'continue', 'review', 'cart', 'purchase'];

export default function AnalyticsPage() {
  const [gateReady, setGateReady] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [gateToken, setGateToken] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [authError, setAuthError] = useState('');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rangeDays, setRangeDays] = useState(DEFAULT_RANGE_DAYS);

  useEffect(() => {
    const stored = readStoredGate();
    if (isGateValid(stored)) {
      setGateToken(stored.token);
      setHasAccess(true);
    }
    setGateReady(true);
  }, []);

  const buildWindowRange = useCallback(() => {
    const now = new Date();
    const toIso = now.toISOString();
    const fromIso = new Date(now.getTime() - rangeDays * DAY_MS).toISOString();
    return { fromIso, toIso };
  }, [rangeDays]);

  const fetchDashboard = useCallback(async (windowRange) => {
    if (!gateToken) return;

    setIsLoading(true);
    setError('');

    try {
      const fromIso = windowRange?.fromIso ?? '';
      const toIso = windowRange?.toIso ?? '';
      const url = `${dashboardEndpoint}?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Prints-Gate': gateToken,
        },
      });

      const text = await response.text();
      const json = text ? JSON.parse(text) : null;

      if (response.status === 401) {
        clearGate();
        setHasAccess(false);
        setGateToken('');
        setAuthError('La sesión expiró. Volvé a ingresar.');
        setData(null);
        return;
      }

      if (response.ok && json?.ok) {
        setData(json);
        setLastUpdated(new Date());
        setError('');
        return;
      }

      setError(typeof json?.error === 'string' ? json.error : 'No se pudieron cargar los datos.');
      setData(null);
    } catch (err) {
      console.error('[analytics] fetch_failed', err);
      setError('Error de conexión al cargar analytics.');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [gateToken]);

  const loadAll = useCallback(async () => {
    if (!hasAccess || !gateToken) return;
    const windowRange = buildWindowRange();
    await fetchDashboard(windowRange);
  }, [buildWindowRange, fetchDashboard, gateToken, hasAccess]);

  useEffect(() => {
    if (!hasAccess || !gateToken) return undefined;

    let cancelled = false;
    const load = async () => {
      if (cancelled) return;
      await loadAll();
    };

    load();
    const intervalId = window.setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [gateToken, hasAccess, loadAll, rangeDays]);

  function handlePasswordSubmit(event) {
    event.preventDefault();
    const trimmed = passwordValue.trim();
    if (!trimmed) {
      setAuthError('Ingresá la contraseña.');
      return;
    }
    if (trimmed !== PRINTS_GATE_PASSWORD) {
      setAuthError('Contraseña incorrecta.');
      return;
    }
    const record = createGateRecord();
    storeGate(record);
    setGateToken(record.token);
    setHasAccess(true);
    setAuthError('');
    setPasswordValue('');
  }

  const handleRangeChange = (event) => {
    const value = Number(event.target.value);
    if (Number.isNaN(value) || value === rangeDays) return;
    setRangeDays(value);
    setData(null);
    setError('');
  };

  const summary = data?.summary ?? {};
  const homeFunnel = data?.home_funnel ?? {};
  const dailyVisits = Array.isArray(data?.daily_visits) ? data.daily_visits : [];
  const eventBreakdown = Array.isArray(data?.event_breakdown) ? data.event_breakdown : [];
  const topMaterials = Array.isArray(data?.top_materials) ? data.top_materials : [];
  const topPaths = Array.isArray(data?.top_paths) ? data.top_paths : [];
  const lastEvents = Array.isArray(data?.last_events) ? data.last_events : [];
  const maxDailyVisitors = dailyVisits.reduce((max, row) => Math.max(max, row.visitors ?? 0), 0) || 1;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Analytics · NOTMID</title>
      </Helmet>

      <header className={styles.header}>
        <h1 className={styles.title}>Analytics del personalizador</h1>
        <p className={styles.subtitle}>
          Visitas, pasos del flujo, abandonos, clics y conversiones.
        </p>
      </header>

      {hasAccess ? (
        <>
          <div className={styles.toolbar}>
            <label className={styles.rangeLabel} htmlFor="analytics-range">
              Período
              <select
                id="analytics-range"
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
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={loadAll}
              disabled={isLoading}
            >
              Actualizar
            </button>
          </div>

          {error ? (
            <div className={styles.errorBox}>
              <span>{error}</span>
              <button type="button" className={styles.secondaryButton} onClick={loadAll}>
                Reintentar
              </button>
            </div>
          ) : null}

          {isLoading && !data ? <p className={styles.status}>Cargando métricas…</p> : null}

          {data?.ok ? (
            <>
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Resumen</h2>
                <div className={styles.cards}>
                  <article className={styles.card}>
                    <span className={styles.cardLabel}>Visitantes únicos</span>
                    <p className={styles.cardValue}>{formatNumber(summary.unique_visitors)}</p>
                  </article>
                  <article className={styles.card}>
                    <span className={styles.cardLabel}>Subieron imagen</span>
                    <p className={styles.cardValue}>{formatNumber(summary.uploads)}</p>
                    <span className={styles.cardHint}>Tasa: {formatPercentage(summary.upload_rate)}</span>
                  </article>
                  <article className={styles.card}>
                    <span className={styles.cardLabel}>Llegaron a revisión</span>
                    <p className={styles.cardValue}>{formatNumber(summary.reached_review)}</p>
                  </article>
                  <article className={styles.card}>
                    <span className={styles.cardLabel}>Agregaron al carrito</span>
                    <p className={styles.cardValue}>{formatNumber(summary.added_to_cart)}</p>
                    <span className={styles.cardHint}>Desde revisión: {formatPercentage(summary.cart_rate)}</span>
                  </article>
                  <article className={styles.card}>
                    <span className={styles.cardLabel}>Compras</span>
                    <p className={styles.cardValue}>{formatNumber(summary.purchases)}</p>
                    <span className={styles.cardHint}>Conversión total: {formatPercentage(summary.completion_rate)}</span>
                  </article>
                </div>
              </section>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Visitas por día</h2>
                {dailyVisits.length ? (
                  <div className={styles.chart}>
                    {dailyVisits.map((row) => (
                      <div key={row.date} className={styles.chartRow}>
                        <span className={styles.chartLabel}>{formatShortDate(row.date)}</span>
                        <div className={styles.chartBarTrack}>
                          <div
                            className={styles.chartBar}
                            style={{ width: `${Math.max(4, (row.visitors / maxDailyVisitors) * 100)}%` }}
                            title={`${row.visitors} visitantes · ${row.page_views} vistas`}
                          />
                        </div>
                        <span className={styles.chartValue}>{formatNumber(row.visitors)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>Sin visitas registradas en este período.</p>
                )}
              </section>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Funnel del personalizador (Home)</h2>
                <div className={styles.funnelList}>
                  {FUNNEL_ORDER.map((key) => {
                    const stage = homeFunnel[key];
                    if (!stage) return null;
                    const dropOff = stage.drop_off_from_visit
                      ?? stage.drop_off_from_upload
                      ?? stage.drop_off_from_edit
                      ?? stage.drop_off_from_continue
                      ?? stage.drop_off_from_review
                      ?? null;
                    const rate = stage.rate_from_visit
                      ?? stage.rate_from_upload
                      ?? stage.rate_from_edit
                      ?? stage.rate_from_continue
                      ?? stage.rate_from_review
                      ?? stage.rate_from_cart
                      ?? null;
                    return (
                      <div key={key} className={styles.funnelItem}>
                        <div className={styles.funnelHead}>
                          <span className={styles.funnelLabel}>{stage.label}</span>
                          <span className={styles.funnelCount}>{formatNumber(stage.rids)} sesiones</span>
                        </div>
                        {rate != null ? (
                          <span className={styles.funnelMeta}>Avance: {formatPercentage(rate)}</span>
                        ) : null}
                        {dropOff != null && dropOff > 0 ? (
                          <span className={styles.funnelDrop}>Abandono: {formatPercentage(dropOff)}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Eventos más frecuentes</h2>
                {eventBreakdown.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Evento</th>
                          <th>Total</th>
                          <th>Sesiones únicas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eventBreakdown.slice(0, 20).map((row) => (
                          <tr key={row.event_name}>
                            <td><code>{row.event_name}</code></td>
                            <td>{formatNumber(row.count)}</td>
                            <td>{formatNumber(row.unique_rids)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.empty}>Sin eventos todavía.</p>
                )}
              </section>

              <div className={styles.twoCol}>
                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>Materiales más elegidos</h2>
                  {topMaterials.length ? (
                    <ul className={styles.simpleList}>
                      {topMaterials.map((row) => (
                        <li key={row.material}>
                          <span>{row.material}</span>
                          <strong>{formatNumber(row.count)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.empty}>Sin datos de materiales.</p>
                  )}
                </section>

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>Páginas más visitadas</h2>
                  {topPaths.length ? (
                    <ul className={styles.simpleList}>
                      {topPaths.map((row) => (
                        <li key={row.path}>
                          <span><code>{row.path}</code></span>
                          <strong>{formatNumber(row.views)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.empty}>Sin rutas registradas.</p>
                  )}
                </section>
              </div>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Últimos eventos</h2>
                {lastEvents.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Evento</th>
                          <th>RID</th>
                          <th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastEvents.map((row, index) => (
                          <tr key={`${row.rid}-${row.created_at}-${index}`}>
                            <td><code>{row.event_name}</code></td>
                            <td className={styles.ridCell}>{row.rid || '—'}</td>
                            <td>{formatWindowDate(row.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.empty}>Sin actividad reciente.</p>
                )}
              </section>

              <p className={styles.meta}>
                {lastUpdated ? `Actualizado: ${lastUpdated.toLocaleString('es-AR')}` : null}
                {data.from && data.to ? ` · Ventana: ${formatWindowDate(data.from)} → ${formatWindowDate(data.to)}` : null}
              </p>
            </>
          ) : null}
        </>
      ) : null}

      {gateReady && !hasAccess ? (
        <div className={busquedaStyles.authOverlay}>
          <div
            className={busquedaStyles.authModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="analytics-auth-title"
          >
            <h2 id="analytics-auth-title" className={busquedaStyles.authTitle}>Acceso restringido</h2>
            <p className={busquedaStyles.authDescription}>
              Ingresá la contraseña para ver las métricas del personalizador.
            </p>
            <form className={busquedaStyles.authForm} onSubmit={handlePasswordSubmit}>
              <label className={busquedaStyles.authLabel} htmlFor="analytics-auth-password">
                Contraseña
              </label>
              <input
                id="analytics-auth-password"
                type="password"
                className={busquedaStyles.authInput}
                autoComplete="current-password"
                autoFocus
                value={passwordValue}
                onChange={(event) => {
                  setPasswordValue(event.target.value);
                  if (authError) setAuthError('');
                }}
              />
              {authError ? <p className={busquedaStyles.authError}>{authError}</p> : null}
              <button type="submit" className={busquedaStyles.btnPrimary}>
                Ingresar
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
