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
import { downloadAnalyticsReport } from '@/lib/analyticsExport.js';

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

const dashboardEndpoints = [
  'https://mgm-api.vercel.app/api/analytics/dashboard',
  '/api/analytics/dashboard',
];

const syncPurchasesEndpoints = [
  'https://mgm-api.vercel.app/api/analytics/sync-purchases',
  '/api/analytics/sync-purchases',
];

const EVENT_LABELS = {
  page_view: 'Vista de página',
  site_visit: 'Visita al sitio',
  home_image_uploaded: 'Subió imagen',
  home_step_edit: 'Paso edición',
  home_step_review: 'Paso revisión',
  continue_design: 'Confirmó diseño',
  home_config_open: 'Abrió configuración',
  home_tools_open: 'Abrió herramientas',
  home_add_to_cart: 'Agregó al carrito',
  home_add_private_cart: 'Compra privada',
  home_return_editor: 'Volvió al editor',
  home_restart: 'Reinició flujo',
  click_replace_image: 'Reemplazó imagen',
  mockup_view: 'Vista mockup',
  view_purchase_options: 'Opciones de compra',
  cta_click_cart: 'CTA carrito',
  cta_click_public: 'CTA público',
  cta_click_private: 'CTA privado',
  purchase_completed: 'Compra completada',
};

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
  return parsed.toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(value) {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

function humanizeEvent(name) {
  if (typeof name !== 'string' || !name) return '—';
  return EVENT_LABELS[name] || name.replace(/_/g, ' ');
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      className={`${styles.refreshIcon} ${spinning ? styles.refreshIconSpin : ''}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg
      className={styles.refreshIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 21h14" strokeLinecap="round" />
    </svg>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 19V5M4 19h16M8 15v-4M12 15V9M16 15v-6" strokeLinecap="round" />
        </svg>
      </div>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyText}>{text}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className={styles.skeletonGrid} aria-hidden="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className={styles.skeletonCard} />
        ))}
      </div>
      <div className={styles.skeletonPanel} aria-hidden="true" />
      <div className={styles.skeletonPanel} aria-hidden="true" />
    </>
  );
}

function KpiCard({ label, value, meta, metaTone }) {
  return (
    <article className={styles.kpiCard}>
      <span className={styles.kpiLabel}>{label}</span>
      <p className={styles.kpiValue}>{value}</p>
      {meta ? (
        <span
          className={`${styles.kpiMeta} ${metaTone === 'positive' ? styles.kpiMetaPositive : ''}`.trim()}
        >
          {meta}
        </span>
      ) : null}
    </article>
  );
}

function DailyChart({ rows }) {
  const maxVisitors = rows.reduce((max, row) => Math.max(max, row.visitors ?? 0), 0) || 1;

  return (
    <div className={styles.barChart} role="img" aria-label="Gráfico de visitantes por día">
      {rows.map((row) => {
        const heightPct = Math.max(4, ((row.visitors ?? 0) / maxVisitors) * 100);
        return (
          <div key={row.date} className={styles.barColumn}>
            <span className={styles.barValue}>{formatNumber(row.visitors)}</span>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                style={{ height: `${heightPct}%` }}
                title={`${row.visitors} visitantes · ${row.page_views} vistas`}
              />
            </div>
            <span className={styles.barLabel}>{formatShortDate(row.date)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DeviceIcon({ type }) {
  if (type === 'mobile') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 20h8" strokeLinecap="round" />
    </svg>
  );
}

function DeviceMetricCard({
  type,
  label,
  value,
  meta,
  cardClass,
}) {
  return (
    <article className={`${styles.deviceMetricCard} ${cardClass}`.trim()}>
      <div className={styles.devicePurchaseCardHead}>
        <DeviceIcon type={type} />
        <span>{label}</span>
      </div>
      <p className={styles.devicePurchaseValue}>{formatNumber(value)}</p>
      {meta ? <p className={styles.devicePurchaseMeta}>{meta}</p> : null}
    </article>
  );
}

function DeviceSplit({ devices }) {
  if (!devices?.total) {
    return (
      <EmptyState
        title="Sin datos de dispositivos"
        text="Cuando haya visitas, verás el reparto entre celular y PC."
      />
    );
  }

  const items = [
    { key: 'mobile', label: 'Celular', data: devices.mobile, barClass: styles.deviceBarMobile },
    { key: 'desktop', label: 'PC', data: devices.desktop, barClass: styles.deviceBarDesktop },
  ];

  const funnelRows = [
    { key: 'visitors', label: 'Visitas' },
    { key: 'uploads', label: 'Subieron imagen' },
    { key: 'reached_review', label: 'Llegaron a revisión' },
    { key: 'added_to_cart', label: 'Agregaron al carrito' },
    { key: 'purchases', label: 'Completaron compra', highlight: true },
  ];

  const completionSplit = devices.completion_split ?? {};
  const cartSplit = devices.cart_split ?? {};
  const purchaseTotal = devices.purchases_total ?? 0;
  const cartTotal = devices.cart_total ?? 0;

  return (
    <div className={styles.deviceAnalytics}>
      <div className={styles.deviceMetricsGrid}>
        <DeviceMetricCard
          type="mobile"
          label="Agregados al carrito (celular)"
          value={devices.mobile?.added_to_cart}
          meta={`${formatPercentage(devices.mobile?.cart_share)} del total · ${formatPercentage(devices.mobile?.cart_from_visit_rate)} desde visita`}
          cardClass={styles.devicePurchaseCardMobile}
        />
        <DeviceMetricCard
          type="desktop"
          label="Agregados al carrito (PC)"
          value={devices.desktop?.added_to_cart}
          meta={`${formatPercentage(devices.desktop?.cart_share)} del total · ${formatPercentage(devices.desktop?.cart_from_visit_rate)} desde visita`}
          cardClass={styles.devicePurchaseCardDesktop}
        />
        <DeviceMetricCard
          type="mobile"
          label="Compras completadas (celular)"
          value={devices.mobile?.purchases}
          meta={`${formatPercentage(devices.mobile?.purchase_share)} del total${purchaseTotal > 0 ? ` · ${formatPercentage(devices.mobile?.completion_rate)} conv.` : ''}`}
          cardClass={styles.devicePurchaseCardMobile}
        />
        <DeviceMetricCard
          type="desktop"
          label="Compras completadas (PC)"
          value={devices.desktop?.purchases}
          meta={`${formatPercentage(devices.desktop?.purchase_share)} del total${purchaseTotal > 0 ? ` · ${formatPercentage(devices.desktop?.completion_rate)} conv.` : ''}`}
          cardClass={styles.devicePurchaseCardDesktop}
        />
      </div>

      {cartTotal > 0 ? (
        <div className={styles.deviceCompletionBarWrap}>
          <p className={styles.deviceBarTitle}>Reparto de carritos</p>
          <div className={styles.deviceCompletionBarTrack} aria-hidden="true">
            <div
              className={`${styles.deviceCompletionBarFill} ${styles.deviceBarMobile}`.trim()}
              style={{ width: `${Math.max(cartSplit.mobile_percent || 0, 2)}%` }}
            />
            <div
              className={`${styles.deviceCompletionBarFill} ${styles.deviceBarDesktop}`.trim()}
              style={{ width: `${Math.max(cartSplit.desktop_percent || 0, 2)}%` }}
            />
          </div>
          <p className={styles.deviceCompletionLegend}>
            {formatNumber(cartSplit.mobile)} celular · {formatNumber(cartSplit.desktop)} PC
          </p>
        </div>
      ) : null}

      {purchaseTotal > 0 ? (
        <div className={styles.deviceCompletionBarWrap}>
          <p className={styles.deviceBarTitle}>Reparto de compras</p>
          <div className={styles.deviceCompletionBarTrack} aria-hidden="true">
            <div
              className={`${styles.deviceCompletionBarFill} ${styles.deviceBarMobile}`.trim()}
              style={{ width: `${Math.max(completionSplit.mobile_percent || 0, 2)}%` }}
            />
            <div
              className={`${styles.deviceCompletionBarFill} ${styles.deviceBarDesktop}`.trim()}
              style={{ width: `${Math.max(completionSplit.desktop_percent || 0, 2)}%` }}
            />
          </div>
          <p className={styles.deviceCompletionLegend}>
            {formatNumber(completionSplit.mobile)} celular · {formatNumber(completionSplit.desktop)} PC
          </p>
        </div>
      ) : null}

      <div className={styles.deviceRow}>
        {items.map((item) => (
          <div key={item.key} className={styles.deviceItem}>
            <div className={styles.deviceIcon}>
              <DeviceIcon type={item.key} />
            </div>
            <div className={styles.deviceInfo}>
              <span className={styles.deviceName}>{item.label}</span>
              <div className={styles.deviceBarTrack}>
                <div
                  className={`${styles.deviceBarFill} ${item.barClass}`.trim()}
                  style={{ width: `${Math.max(item.data?.visit_share || item.data?.percent || 0, 2)}%` }}
                />
              </div>
            </div>
            <div className={styles.deviceStat}>
              <span className={styles.devicePercent}>
                {formatPercentage(item.data?.visit_share || item.data?.percent)}
              </span>
              <span className={styles.deviceCount}>{formatNumber(item.data?.visitors)} visitas</span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.deviceTableWrap}>
        <table className={styles.deviceTable}>
          <thead>
            <tr>
              <th>Etapa</th>
              <th className={styles.tableNum}>Celular</th>
              <th className={styles.tableNum}>PC</th>
            </tr>
          </thead>
          <tbody>
            {funnelRows.map((row) => (
              <tr key={row.key} className={row.highlight ? styles.deviceTableHighlight : ''}>
                <td>{row.label}</td>
                <td className={styles.tableNum}>{formatNumber(devices.mobile?.[row.key])}</td>
                <td className={styles.tableNum}>{formatNumber(devices.desktop?.[row.key])}</td>
              </tr>
            ))}
            <tr className={styles.deviceTableRates}>
              <td>Conversión visita → compra</td>
              <td className={styles.tableNum}>{formatPercentage(devices.mobile?.completion_rate)}</td>
              <td className={styles.tableNum}>{formatPercentage(devices.desktop?.completion_rate)}</td>
            </tr>
            <tr className={styles.deviceTableRates}>
              <td>Tasa subida de imagen</td>
              <td className={styles.tableNum}>{formatPercentage(devices.mobile?.upload_rate)}</td>
              <td className={styles.tableNum}>{formatPercentage(devices.desktop?.upload_rate)}</td>
            </tr>
            <tr className={styles.deviceTableRates}>
              <td>Tasa carrito (desde revisión)</td>
              <td className={styles.tableNum}>{formatPercentage(devices.mobile?.cart_rate)}</td>
              <td className={styles.tableNum}>{formatPercentage(devices.desktop?.cart_rate)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaterialSizePanel({ combos }) {
  if (!combos?.length) {
    return (
      <EmptyState
        title="Sin combinaciones todavía"
        text="Se registran al subir imagen, confirmar diseño o agregar al carrito."
      />
    );
  }

  return (
    <RankList
      items={combos}
      labelKey="label"
      valueKey="count"
    />
  );
}

function RankList({ items, valueKey, labelKey, code }) {
  return (
    <ol className={styles.rankList}>
      {items.map((row, index) => (
        <li key={row[labelKey] ?? index} className={styles.rankItem}>
          <span className={styles.rankIndex}>{index + 1}</span>
          <span className={`${styles.rankLabel} ${code ? styles.codeCell : ''}`.trim()}>
            {code ? row[labelKey] : row[labelKey]}
          </span>
          <strong className={styles.rankValue}>{formatNumber(row[valueKey])}</strong>
        </li>
      ))}
    </ol>
  );
}

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
  const [syncMessage, setSyncMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

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

    const fromIso = windowRange?.fromIso ?? '';
    const toIso = windowRange?.toIso ?? '';
    let lastErrorMessage = 'No se pudieron cargar los datos.';

    try {
      for (const endpoint of dashboardEndpoints) {
        try {
          // skip_sync=1: el dashboard no debe esperar Shopify (evita 504/CORS fantasma).
          const url = `${endpoint}?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&skip_sync=1`;
          const response = await fetch(url, {
            headers: {
              Accept: 'application/json',
              'X-Prints-Gate': gateToken,
            },
          });

          const text = await response.text();
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }

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

          lastErrorMessage = typeof json?.error === 'string'
            ? json.error
            : `Error ${response.status || 'desconocido'} al cargar analytics`;
        } catch (err) {
          lastErrorMessage = err instanceof Error ? err.message : 'Error de conexión';
        }
      }

      setError(lastErrorMessage);
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

  const syncPurchases = useCallback(async () => {
    if (!gateToken) return;
    setIsSyncing(true);
    setSyncMessage('');

    let lastError = 'No se pudo sincronizar compras.';
    try {
      for (const endpoint of syncPurchasesEndpoints) {
        try {
          const response = await fetch(`${endpoint}?days=${rangeDays}`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'X-Prints-Gate': gateToken,
            },
          });
          const json = await response.json().catch(() => null);
          if (response.ok && json?.ok) {
            const recorded = json.recorded ?? 0;
            const scanned = json.scanned ?? 0;
            setSyncMessage(
              recorded > 0
                ? `Sincronizado: ${recorded} compra(s) nueva(s) de ${scanned} pedido(s) pagado(s) en Shopify.`
                : `Revisados ${scanned} pedido(s) pagado(s). Ninguno nuevo para registrar (o ya estaban).`,
            );
            await loadAll();
            return;
          }
          lastError = typeof json?.detail === 'string'
            ? json.detail
            : typeof json?.error === 'string'
              ? json.error
              : lastError;
        } catch (err) {
          lastError = err instanceof Error ? err.message : lastError;
        }
      }
      setSyncMessage(lastError);
    } finally {
      setIsSyncing(false);
    }
  }, [gateToken, rangeDays, loadAll]);

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

  const handleRangeChange = (days) => {
    if (days === rangeDays) return;
    setRangeDays(days);
    setData(null);
    setError('');
    setExportMessage('');
  };

  const handleExportReport = () => {
    if (!data?.ok) {
      setExportMessage('Esperá a que carguen los datos antes de exportar.');
      return;
    }
    try {
      const filename = downloadAnalyticsReport(data, { rangeDays, exportedAt: lastUpdated || new Date() });
      setExportMessage(`Reporte descargado: ${filename}`);
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : 'No se pudo exportar el reporte.');
    }
  };

  const summary = data?.summary ?? {};
  const dailyVisits = Array.isArray(data?.daily_visits) ? data.daily_visits : [];
  const eventBreakdown = Array.isArray(data?.event_breakdown) ? data.event_breakdown : [];
  const topMaterials = Array.isArray(data?.top_materials) ? data.top_materials : [];
  const topSizes = Array.isArray(data?.top_sizes) ? data.top_sizes : [];
  const topMaterialSizes = Array.isArray(data?.top_material_sizes) ? data.top_material_sizes : [];
  const devices = data?.devices ?? null;
  const purchasesDetail = Array.isArray(data?.purchases_detail) ? data.purchases_detail : [];
  const purchaseSync = data?.purchase_sync ?? null;
  const lastEvents = Array.isArray(data?.last_events) ? data.last_events : [];

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Analytics · NOTMID</title>
      </Helmet>

      <div className={styles.topBar}>
        <div className={styles.topBarMain}>
          <p className={styles.eyebrow}>NOTMID · Métricas</p>
          <h1 className={styles.title}>Analytics del personalizador</h1>
          <p className={styles.subtitle}>
            Visitas, embudo, abandonos, dispositivos y conversiones en tiempo real.
          </p>
        </div>

        {hasAccess ? (
          <div className={styles.topBarActions}>
            <div className={styles.periodGroup} role="group" aria-label="Período de análisis">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`${styles.periodBtn} ${rangeDays === option ? styles.periodBtnActive : ''}`.trim()}
                  onClick={() => handleRangeChange(option)}
                  disabled={isLoading}
                  aria-pressed={rangeDays === option}
                >
                  {option}d
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.exportBtn}
              onClick={handleExportReport}
              disabled={!data?.ok || isLoading}
              title={`Descargar reporte Markdown (${rangeDays} días) para analizar con IA`}
            >
              <ExportIcon />
              <span>Exportar reporte</span>
            </button>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={loadAll}
              disabled={isLoading}
              aria-busy={isLoading}
            >
              <RefreshIcon spinning={isLoading} />
              <span>{isLoading ? 'Actualizando…' : 'Actualizar'}</span>
            </button>
          </div>
        ) : null}
      </div>

      {hasAccess && exportMessage ? (
        <p className={styles.exportMessage} role="status">{exportMessage}</p>
      ) : null}

      {hasAccess ? (
        <>
          {error ? (
            <div className={`${styles.alert} ${styles.alertError}`.trim()} role="alert">
              <span>{error}</span>
              <button type="button" className={styles.refreshBtn} onClick={loadAll}>
                Reintentar
              </button>
            </div>
          ) : null}

          {isLoading && !data ? <LoadingSkeleton /> : null}

          {data?.ok ? (
            <>
              {data.warning === 'track_events_unavailable' ? (
                <div className={`${styles.alert} ${styles.alertWarning}`.trim()} role="status">
                  {typeof data.warning_detail === 'string' && data.warning_detail ? (
                    <>
                      La API no puede leer <code>track_events</code> en Supabase:
                      {' '}
                      <code>{data.warning_detail}</code>
                    </>
                  ) : (
                    <>
                      La tabla de eventos no está accesible. Corré la migración
                      {' '}
                      <code>20260711120000_track_events.sql</code>
                    </>
                  )}
                </div>
              ) : null}

              <section aria-label="Indicadores clave">
                <div className={styles.kpiGrid}>
                  <KpiCard
                    label="Visitantes únicos"
                    value={formatNumber(summary.unique_visitors)}
                  />
                  <KpiCard
                    label="Subieron imagen"
                    value={formatNumber(summary.uploads)}
                    meta={`Tasa ${formatPercentage(summary.upload_rate)}`}
                    metaTone="positive"
                  />
                  <KpiCard
                    label="Llegaron a revisión"
                    value={formatNumber(summary.reached_review)}
                  />
                  <KpiCard
                    label="Agregaron al carrito"
                    value={formatNumber(summary.added_to_cart)}
                    meta={`Desde revisión ${formatPercentage(summary.cart_rate)}`}
                  />
                  <KpiCard
                    label="Compras"
                    value={formatNumber(summary.purchases)}
                    meta={`Conversión ${formatPercentage(summary.completion_rate)}`}
                    metaTone="positive"
                  />
                </div>
                <div className={styles.purchaseSyncRow}>
                  <p className={styles.purchaseSyncHint}>
                    Las compras se sincronizan solas desde Shopify (cada ~10 min al abrir analytics
                    y cada 15 min en segundo plano). El botón fuerza una sync inmediata.
                  </p>
                  <button
                    type="button"
                    className={styles.syncPurchasesBtn}
                    onClick={syncPurchases}
                    disabled={isSyncing}
                  >
                    {isSyncing ? 'Sincronizando…' : 'Sincronizar ahora'}
                  </button>
                </div>
                {syncMessage ? (
                  <p className={styles.syncMessage} role="status">{syncMessage}</p>
                ) : purchaseSync?.recorded > 0 ? (
                  <p className={styles.syncMessage} role="status">
                    Sync automática: {formatNumber(purchaseSync.recorded)} compra(s) nueva(s) registrada(s).
                  </p>
                ) : null}
                {purchasesDetail.length ? (
                  <div className={styles.purchasesDetailList}>
                    {purchasesDetail.map((row, index) => (
                      <span key={`${row.order_id || row.rid}-${index}`} className={styles.purchaseChip}>
                        {row.order_name || row.order_id || 'Compra'}
                        {row.total_price ? ` · $${row.total_price}` : ''}
                      </span>
                    ))}
                  </div>
                ) : summary.purchases === 0 ? (
                  <p className={styles.purchaseEmptyNote}>
                    Todavía no hay compras registradas en analytics para este período.
                  </p>
                ) : null}
              </section>

              <div className={styles.mainGrid}>
                <div className={styles.stack}>
                  <section className={styles.panel} aria-labelledby="chart-visits-title">
                    <div className={styles.panelHeader}>
                      <h2 id="chart-visits-title" className={styles.panelTitle}>Visitas por día</h2>
                      <p className={styles.panelHint}>Visitantes únicos por fecha</p>
                    </div>
                    <div className={styles.panelBody}>
                      {dailyVisits.length ? (
                        <DailyChart rows={dailyVisits} />
                      ) : (
                        <EmptyState
                          title="Sin visitas en este período"
                          text="Abrí el personalizador en otra pestaña para generar la primera visita."
                        />
                      )}
                    </div>
                  </section>

                  <section className={styles.panel} aria-labelledby="events-title">
                    <div className={styles.panelHeader}>
                      <h2 id="events-title" className={styles.panelTitle}>Eventos más frecuentes</h2>
                      <p className={styles.panelHint}>Top 20 por volumen</p>
                    </div>
                    {eventBreakdown.length ? (
                      <div className={styles.tableScroll}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Evento</th>
                              <th className={styles.tableNum}>Total</th>
                              <th className={styles.tableNum}>Sesiones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {eventBreakdown.slice(0, 20).map((row) => (
                              <tr key={row.event_name}>
                                <td>
                                  <span>{humanizeEvent(row.event_name)}</span>
                                  <br />
                                  <span className={styles.codeCell}>{row.event_name}</span>
                                </td>
                                <td className={styles.tableNum}>{formatNumber(row.count)}</td>
                                <td className={styles.tableNum}>{formatNumber(row.unique_rids)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className={styles.panelBody}>
                        <EmptyState
                          title="Sin eventos registrados"
                          text="Los eventos aparecen cuando alguien usa el personalizador."
                        />
                      </div>
                    )}
                  </section>
                </div>

                <div className={styles.stack}>
                  <section className={styles.panel} aria-labelledby="devices-title">
                    <div className={styles.panelHeader}>
                      <h2 id="devices-title" className={styles.panelTitle}>Celular vs PC</h2>
                      <p className={styles.panelHint}>Carrito, compras y embudo por dispositivo</p>
                    </div>
                    <div className={styles.panelBody}>
                      <DeviceSplit devices={devices} />
                    </div>
                  </section>

                  <section className={styles.panel} aria-labelledby="material-size-title">
                    <div className={styles.panelHeader}>
                      <h2 id="material-size-title" className={styles.panelTitle}>Medida y material más pedido</h2>
                      <p className={styles.panelHint}>Combinaciones más elegidas</p>
                    </div>
                    <div className={styles.panelBody}>
                      <MaterialSizePanel combos={topMaterialSizes} />
                    </div>
                  </section>
                </div>
              </div>

              <div className={styles.splitGrid}>
                <section className={styles.panel} aria-labelledby="materials-title">
                  <div className={styles.panelHeader}>
                    <h2 id="materials-title" className={styles.panelTitle}>Materiales</h2>
                  </div>
                  <div className={styles.panelBody}>
                    {topMaterials.length ? (
                      <RankList
                        items={topMaterials}
                        labelKey="material"
                        valueKey="count"
                      />
                    ) : (
                      <EmptyState title="Sin materiales" text="Se registran al subir o confirmar diseño." />
                    )}
                  </div>
                </section>

                <section className={styles.panel} aria-labelledby="sizes-title">
                  <div className={styles.panelHeader}>
                    <h2 id="sizes-title" className={styles.panelTitle}>Medidas elegidas</h2>
                    <p className={styles.panelHint}>Tamaños más usados</p>
                  </div>
                  <div className={styles.panelBody}>
                    {topSizes.length ? (
                      <RankList
                        items={topSizes}
                        labelKey="size"
                        valueKey="count"
                      />
                    ) : (
                      <EmptyState title="Sin medidas" text="Se registran al elegir tamaño en el personalizador." />
                    )}
                  </div>
                </section>
              </div>

              <section className={styles.panel} aria-labelledby="recent-title">
                <div className={styles.panelHeader}>
                  <h2 id="recent-title" className={styles.panelTitle}>Actividad reciente</h2>
                  <p className={styles.panelHint}>Últimos 50 eventos</p>
                </div>
                {lastEvents.length ? (
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Evento</th>
                          <th>Sesión</th>
                          <th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastEvents.map((row, index) => (
                          <tr key={`${row.rid}-${row.created_at}-${index}`}>
                            <td>{humanizeEvent(row.event_name)}</td>
                            <td className={`${styles.codeCell} ${styles.ridCell}`.trim()}>
                              {row.rid || '—'}
                            </td>
                            <td>{formatWindowDate(row.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className={styles.panelBody}>
                    <EmptyState title="Sin actividad reciente" text="Los eventos nuevos aparecen acá al instante." />
                  </div>
                )}
              </section>

              <footer className={styles.footerMeta}>
                {lastUpdated ? (
                  <span className={styles.liveDot}>
                    Actualizado {lastUpdated.toLocaleString('es-AR')}
                  </span>
                ) : null}
                {data.from && data.to ? (
                  <span>
                    Período: {formatWindowDate(data.from)} → {formatWindowDate(data.to)}
                  </span>
                ) : null}
                <span>Auto-refresh cada 60 s</span>
              </footer>
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
