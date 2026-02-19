import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { apiFetch } from '@/lib/api.js';
import { publicUrlForMockup } from '@/lib/previewPath.js';
import { normalizePreviewUrl, pdfKeyToPreviewKey } from '@/lib/preview.js';
import {
  PRINTS_GATE_PASSWORD,
  createGateRecord,
  readStoredGate,
  storeGate,
  clearGate,
  isGateValid,
} from '@/lib/printsGate.js';
import styles from './Busqueda.module.css';
import { diag, warn } from '@/lib/log';

const PAGE_LIMIT = 25;

function looksLikePdfUrl(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.endsWith('.pdf')) return true;
  return normalized.includes('.pdf?') || normalized.includes('.pdf#');
}

function isUsableImageSrc(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || looksLikePdfUrl(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed)
    || trimmed.startsWith('/')
    || /^data:image\//i.test(trimmed)
    || /^blob:/i.test(trimmed);
}

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

function buildDownloadUrl(publicUrl, filename) {
  const url = new URL(publicUrl);
  if (!url.searchParams.has('download')) {
    url.searchParams.set('download', filename || '');
  }
  return url.toString();
}

function PreviewThumbnail({ src }) {
  const [status, setStatus] = useState(src ? 'loading' : 'fallback');

  useEffect(() => {
    setStatus(src ? 'loading' : 'fallback');
  }, [src]);

  useEffect(() => {
    if (!src || status !== 'loading') return undefined;
    const timeoutId = window.setTimeout(() => {
      setStatus((current) => (current === 'loading' ? 'error' : current));
    }, 8000);
    return () => window.clearTimeout(timeoutId);
  }, [src, status]);

  const showLoading = Boolean(src) && status === 'loading';
  const showFallback = status === 'fallback';

  return (
    <>
      {showLoading ? <span className={styles.previewPlaceholder}>Cargando…</span> : null}
      {showFallback ? <div className={styles.previewPlaceholder}>Sin vista previa</div> : null}
      {src && !showFallback && status !== 'failed' ? (
        <img
          src={src}
          alt="Miniatura MGMGAMERS"
          className={styles.previewImage}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => {
            setStatus('loaded');
          }}
          onError={() => {
            setStatus('failed');
          }}
          style={showLoading ? { display: 'none' } : undefined}
        />
      ) : null}
    </>
  );
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

  const SUPA_URL = (import.meta.env?.VITE_SUPABASE_URL
    || import.meta.env?.NEXT_PUBLIC_SUPABASE_URL
    || '').replace(/\/+$/, '');

  const getPreviewUrlFromRecord = useCallback((rec) => {
    if (!rec) return null;
    const previewUrlCandidates = [rec.previewUrl, rec.preview_url, rec.mockupPublicUrl, rec.mockup_public_url];
    for (const candidate of previewUrlCandidates) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      if (trimmed.startsWith('/api/prints/preview') || /^api\/prints\/preview/i.test(trimmed)) {
        continue;
      }
      if (/^\/storage\/v1\/object\//i.test(trimmed) && SUPA_URL) {
        return `${SUPA_URL}${trimmed}`;
      }
      if (/^storage\/v1\/object\//i.test(trimmed) && SUPA_URL) {
        return `${SUPA_URL}/${trimmed}`;
      }
      const normalized = normalizePreviewUrl(trimmed, SUPA_URL);
      if (normalized && !looksLikePdfUrl(normalized)) return normalized;
    }
    if (typeof rec.mockupUrl === 'string') {
      const normalized = normalizePreviewUrl(rec.mockupUrl.trim(), SUPA_URL);
      if (normalized && !looksLikePdfUrl(normalized)) return normalized;
    }
    const previewKeyCandidates = [rec.previewKey, rec.preview_key, rec.mockupKey, rec.mockup_key, rec.previewObjectKey];
    for (const candidate of previewKeyCandidates) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const prefixed = trimmed.startsWith('preview/')
        ? trimmed
        : trimmed.startsWith('outputs/')
          ? `preview/${trimmed.replace(/^outputs\//i, '')}`
          : `preview/${trimmed.replace(/^\/+/, '')}`;
      const normalized = normalizePreviewUrl(trimmed, SUPA_URL)
        || normalizePreviewUrl(prefixed, SUPA_URL);
      if (normalized && !looksLikePdfUrl(normalized)) return normalized;
    }
    const pdfCandidates = [rec.pdfKey, rec.pdf, rec.path, rec.pdfPublicUrl, rec.pdf_public_url];
    for (const candidate of pdfCandidates) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      let key = trimmed;
      if (/^https?:\/\//i.test(trimmed)) {
        try {
          const parsed = new URL(trimmed);
          key = parsed.pathname.replace(/^\/+/, '');
        } catch {
          key = trimmed;
        }
      }
      key = key.replace(/^storage\/v1\/object\/public\//i, '');
      const previewKey = pdfKeyToPreviewKey(key);
      if (previewKey) {
        const normalized = normalizePreviewUrl(previewKey, SUPA_URL);
        if (normalized && !looksLikePdfUrl(normalized)) return normalized;
      }
    }
    const fallback = publicUrlForMockup(rec)
      || rec.image
      || rec.thumbnail
      || rec.thumbUrl
      || rec.thumb_url
      || null;
    return typeof fallback === 'string' && !looksLikePdfUrl(fallback) ? fallback : null;
  }, [SUPA_URL]);

  const normalizedResults = useMemo(
    () => results.map((row) => ({
      ...row,
      previewUrl: getPreviewUrlFromRecord(row),
    })),
    [results, getPreviewUrlFromRecord],
  );

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
      params.delete('sort');
      params.delete('sortBy');
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
      error('[prints-search]', requestError);
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
  const hasResults = normalizedResults.length > 0;
  const noResultsMessage = searched && !loading && !hasResults && !error;

  // === Helpers para resolver URL pública del preview (Supabase) ===
  const resolvePreviewUrl = (row) => {
    const candidate = row?.previewUrl;
    if (!isUsableImageSrc(candidate)) return null;
    return candidate;
  };

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
                normalizedResults.map((row) => {
                  const key = row.id || row.path || row.fileName;
                  const measurement = formatMeasurement(row.widthCm, row.heightCm);
                  const filename = row.name || row.fileName || 'archivo.pdf';
                  const rawDownloadUrl = row.downloadUrl || row.url || row.publicUrl || '';
                  let downloadHref = '';
                  if (rawDownloadUrl) {
                    try {
                      downloadHref = buildDownloadUrl(rawDownloadUrl, filename);
                    } catch (error) {
                      if (import.meta.env?.DEV) {
                        warn('[prints] invalid download URL', {
                          error,
                          rawDownloadUrl,
                        });
                      }
                    }
                  }
                  console.log('[Busqueda] preview debug', {
                    id: row.id || row.path || row.fileName || null,
                    preview_url: row.preview_url ?? null,
                    mockup_public_url: row.mockup_public_url ?? null,
                    resolvedPreviewUrl: row.previewUrl ?? null,
                  });
                  if (import.meta.env?.DEV) {
                    diag('[prints] preview', {
                      name: row.fileName || row.name,
                      preview: row.previewUrl,
                    });
                  }
                  return (
                    <tr key={key}>
                      <td className={`${styles.previewCell} preview-cell`}>
                        <PreviewThumbnail src={resolvePreviewUrl(row)} />
                      </td>
                      <td className={styles.fileCell}>{row.fileName || row.name || '-'}</td>
                      <td className={styles.measureCell}>{measurement}</td>
                      <td className={styles.materialCell}>{row.material || '-'}</td>
                      <td className={styles.sizeCell}>{formatBytes(row.sizeBytes ?? row.size)}</td>
                      <td className={styles.dateCell}>{formatDate(row.createdAt)}</td>
                      <td>
                        {downloadHref ? (
                          <a
                            className={styles.downloadLink}
                            href={downloadHref}
                            download={filename}
                            target="_self"
                            rel="nofollow"
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
