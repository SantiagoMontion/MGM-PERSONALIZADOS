import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { apiFetch } from '@/lib/api.js';
import {
  PRINTS_GATE_PASSWORD,
  createGateRecord,
  readStoredGate,
  storeGate,
  clearGate,
  isGateValid,
} from '@/lib/printsGate.js';
import styles from './Busqueda.module.css';

const PAGE_LIMIT = 25;

function formatBytes(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  const formatted = current < 10 && index > 0 ? current.toFixed(1) : Math.round(current);
  return `${formatted} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatMeasurement(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '-';
  const normalize = (value) => {
    if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
    return value.toFixed(1).replace(/\.0+$/, '');
  };
  return `${normalize(w)}x${normalize(h)} cm`;
}

export default function Busqueda() {
  const [gateReady, setGateReady] = useState(typeof window === 'undefined');
  const [hasAccess, setHasAccess] = useState(false);
  const [gateToken, setGateToken] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [authError, setAuthError] = useState('');
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const record = readStoredGate();
    if (isGateValid(record)) {
      setHasAccess(true);
      setGateToken(record?.token || '');
      setAuthError('');
    } else {
      if (record) clearGate();
      setHasAccess(false);
      setGateToken('');
    }
    setGateReady(true);
  }, []);

  useEffect(() => {
    if (hasAccess) {
      setAuthError('');
    }
  }, [hasAccess]);

  const showingRange = useMemo(() => {
    if (!searched || total === 0 || results.length === 0) return '';
    const from = offset + 1;
    const to = offset + results.length;
    return `Mostrando ${from}-${to} de ${total}`;
  }, [searched, total, results.length, offset]);

  async function performSearch(nextQuery, nextOffset = 0) {
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      setError('Ingresá un término para buscar.');
      setResults([]);
      setTotal(0);
      setSearched(false);
      return;
    }

    if (!hasAccess) {
      setAuthError('Ingresá la contraseña temporal para buscar.');
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort?.();
    abortRef.current = controller;

    setLoading(true);
    setError('');
    setSearched(true);

    try {
      const params = new URLSearchParams({
        query: trimmed,
        limit: String(PAGE_LIMIT),
        offset: String(Math.max(0, nextOffset)),
      });
      const endpoint = `/api/prints/search?${params.toString()}`;
      const headers = { Accept: 'application/json' };
      if (gateToken) {
        headers['X-Prints-Gate'] = gateToken;
      }
      const response = await apiFetch('GET', endpoint, undefined, {
        signal: controller.signal,
        headers,
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401 || payload?.reason === 'unauthorized') {
        clearGate();
        setGateToken('');
        setHasAccess(false);
        setAuthError('La contraseña expiró. Ingresala de nuevo.');
        setError('Necesitás ingresar la contraseña temporal para buscar.');
        setPasswordValue('');
        setResults([]);
        setTotal(0);
        setSearched(false);
        return;
      }

      if (!response.ok) {
        const message = typeof payload?.message === 'string'
          ? payload.message
          : typeof payload?.detail === 'string'
            ? payload.detail
            : typeof payload?.error === 'string'
              ? payload.error
              : `Error ${response.status}`;
        setError(message === 'missing_query' || message === 'query_too_short'
          ? 'Ingresá al menos 2 caracteres para buscar.'
          : `No se pudo realizar la búsqueda (${message}).`);
        setResults([]);
        setTotal(0);
        setLastQuery(trimmed);
        setOffset(nextOffset);
        return;
      }

      const items = Array.isArray(payload?.items) ? payload.items : [];
      const totalItemsRaw = payload?.total ?? payload?.pagination?.total;
      const usedOffsetRaw = payload?.offset ?? payload?.pagination?.offset;
      const totalItems = Number.isFinite(Number(totalItemsRaw)) ? Number(totalItemsRaw) : items.length;
      const usedOffset = Number.isFinite(Number(usedOffsetRaw)) ? Number(usedOffsetRaw) : nextOffset;

      setResults(items);
      setTotal(totalItems);
      setOffset(Math.max(0, usedOffset));
      setLastQuery(trimmed);
    } catch (requestError) {
      if (requestError?.name === 'AbortError') {
        return;
      }
      console.error('[prints-search]', requestError);
      setError('Ocurrió un error al buscar en Supabase.');
      setResults([]);
      setTotal(0);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    performSearch(query, 0);
  }

  function handlePrevious() {
    if (loading) return;
    const nextOffset = Math.max(0, offset - PAGE_LIMIT);
    performSearch(lastQuery || query, nextOffset);
  }

  function handleNext() {
    if (loading) return;
    const nextOffset = offset + PAGE_LIMIT;
    performSearch(lastQuery || query, nextOffset);
  }

  function handlePasswordSubmit(event) {
    event.preventDefault();
    if (loading) return;
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
    setError('');
    if (query.trim()) {
      setTimeout(() => {
        performSearch(query, 0);
      }, 0);
    }
  }

  const canShowPagination = searched && total > PAGE_LIMIT;
  const hasResults = results.length > 0;
  const noResultsMessage = searched && !loading && !hasResults && !error;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Buscar PDFs · MGM</title>
      </Helmet>
      <header className={styles.header}>
        <h1 className={styles.title}>Buscador de PDFs</h1>
        <p className={styles.description}>
          Ingresá el nombre, slug o medida para encontrar y descargar el PDF de producción.
        </p>
      </header>

      <section className={styles.searchCard}>
        <form className={styles.searchForm} onSubmit={handleSubmit}>
          <div className={styles.inputWrapper}>
            <label className={styles.label} htmlFor="busqueda-query">
              Buscar PDF
            </label>
            <input
              id="busqueda-query"
              className={styles.input}
              type="text"
              placeholder="Ej: darth 90x40 classic"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={loading || !hasAccess}
            />
          </div>
          <button type="submit" className={styles.searchButton} disabled={loading || !hasAccess}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        {error ? (
          <p className={`${styles.feedback} ${styles.error}`}>{error}</p>
        ) : showingRange ? (
          <p className={styles.feedback}>{showingRange}</p>
        ) : null}
      </section>

      <section className={styles.resultsCard}>
        <div className={styles.resultsTableWrapper}>
          <table className={styles.resultsTable}>
            <thead>
              <tr>
                <th scope="col">Vista previa</th>
                <th scope="col">Archivo</th>
                <th scope="col">Medida</th>
                <th scope="col">Material</th>
                <th scope="col">Tamaño</th>
                <th scope="col">Fecha</th>
                <th scope="col">Descargar</th>
              </tr>
            </thead>
            <tbody>
              {hasResults ? (
                results.map((item) => {
                  const key = item.id || item.path || item.fileName;
                  const measurement = formatMeasurement(item.widthCm, item.heightCm);
                  const previewContent = item.previewUrl ? (
                    <img
                      src={item.previewUrl}
                      alt={item.fileName || 'preview'}
                      className={styles.previewImage}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className={styles.previewPlaceholder} aria-label="PDF">PDF</span>
                  );
                  return (
                    <tr key={key}>
                      <td className={styles.previewCell}>
                        {previewContent}
                      </td>
                      <td className={styles.fileCell}>{item.fileName || item.name || '-'}</td>
                      <td className={styles.measureCell}>{measurement}</td>
                      <td className={styles.materialCell}>{item.material || '-'}</td>
                      <td className={styles.sizeCell}>{formatBytes(item.sizeBytes ?? item.size)}</td>
                      <td className={styles.dateCell}>{formatDate(item.createdAt)}</td>
                      <td>
                        {item.downloadUrl ? (
                          <a
                            className={styles.downloadLink}
                            href={item.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Descargar PDF
                          </a>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className={styles.noResults} colSpan={7}>
                    {noResultsMessage ? 'No encontramos PDFs que coincidan.' : 'Sin resultados aún.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canShowPagination ? (
          <div className={styles.pagination}>
            <button type="button" onClick={handlePrevious} disabled={loading || offset === 0}>
              Anterior
            </button>
            <p className={styles.paginationStatus}>{showingRange}</p>
            <button
              type="button"
              onClick={handleNext}
              disabled={loading || offset + PAGE_LIMIT >= total}
            >
              Siguiente
            </button>
          </div>
        ) : null}
      </section>

      {gateReady && !hasAccess ? (
        <div className={styles.authOverlay}>
          <div
            className={styles.authModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prints-auth-title"
          >
            <h2 id="prints-auth-title" className={styles.authTitle}>Acceso restringido</h2>
            <p className={styles.authDescription}>
              Ingresá la contraseña temporal para buscar y descargar los PDFs de imprenta.
            </p>
            <form className={styles.authForm} onSubmit={handlePasswordSubmit}>
              <label className={styles.authLabel} htmlFor="prints-auth-password">
                Contraseña
              </label>
              <input
                id="prints-auth-password"
                type="password"
                className={styles.authInput}
                autoComplete="current-password"
                autoFocus
                value={passwordValue}
                onChange={(event) => {
                  setPasswordValue(event.target.value);
                  if (authError) setAuthError('');
                }}
                disabled={loading}
              />
              {authError ? <p className={styles.authError}>{authError}</p> : null}
              <button type="submit" className={styles.authButton} disabled={loading}>
                Ingresar
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
