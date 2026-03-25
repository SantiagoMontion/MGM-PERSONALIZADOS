import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { apiFetch } from '@/lib/api.js';
import { publicUrlForMockup } from '@/lib/previewPath.js';
import { normalizePreviewUrl, resolvePreviewUrlFromPdfKey } from '@/lib/preview.js';
import {
  PRINTS_GATE_PASSWORD,
  createGateRecord,
  readStoredGate,
  storeGate,
  clearGate,
  isGateValid,
} from '@/lib/printsGate.js';
import styles from './Busqueda.module.css';
import { diag, error as logError, warn } from '@/lib/log';

/** Filas por página de búsqueda (más resultados por request; ajustá si pesan las firmas). */
const PAGE_LIMIT = 25;
const RECENTS_LIMIT = 25;

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

function computePrintRowFields(row) {
  const key = row.id || row.path || row.fileName;
  const measurement = formatMeasurement(row.widthCm, row.heightCm);
  const filename = row.fileName || row.name || 'archivo.pdf';
  const rawDownloadUrl = row.downloadUrl || row.url || row.publicUrl || '';
  let downloadHref = '';
  if (rawDownloadUrl) {
    try {
      downloadHref = buildDownloadUrl(rawDownloadUrl, filename);
    } catch (err) {
      if (import.meta.env?.DEV) {
        warn('[prints] invalid download URL', {
          error: err,
          rawDownloadUrl,
        });
      }
    }
  }
  const previewSrc = isUsableImageSrc(row?.previewUrl) ? row.previewUrl : null;
  return { key, measurement, filename, downloadHref, previewSrc };
}

function buildDownloadUrl(publicUrl, filename) {
  const url = new URL(publicUrl);
  if (!url.searchParams.has('download')) {
    url.searchParams.set('download', filename || '');
  }
  return url.toString();
}

function PreviewThumbnail({ src }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src) {
    return <div className={styles.previewPlaceholder}>—</div>;
  }

  if (failed) {
    return <div className={styles.previewPlaceholder}>Sin vista previa</div>;
  }

  return (
    <div className={styles.previewThumbWrap}>
      <img
        src={src}
        alt=""
        className={styles.previewImage}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
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
  const [hasMore, setHasMore] = useState(false);
  const [cursorStack, setCursorStack] = useState([null]); // null = primera página
  const currentCursor = cursorStack[cursorStack.length - 1] ?? null;
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [recentsLoaded, setRecentsLoaded] = useState(false);
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
    } else {
      setRecentsLoaded(false);
      setResults([]);
      setSearched(false);
      setCursorStack([null]);
      setHasMore(false);
      setNextCursor(null);
      setLastQuery('');
    }
  }, [hasAccess]);

  useEffect(() => {
    if (typeof window === 'undefined' || !gateReady || !hasAccess || recentsLoaded) return undefined;

    const controller = new AbortController();
    const headers = { Accept: 'application/json' };
    if (gateToken) headers['X-Prints-Gate'] = gateToken;

    (async () => {
      try {
        const params = new URLSearchParams({
          limit: String(RECENTS_LIMIT),
        });
        const response = await apiFetch(
          'GET',
          `/api/prints/search?${params.toString()}`,
          undefined,
          { signal: controller.signal, headers },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return;
        let items = Array.isArray(payload?.items) ? payload.items : [];
        if (items.length > RECENTS_LIMIT) {
          items = items.slice(0, RECENTS_LIMIT);
        }
        setResults(items);
        setHasMore(Boolean(payload?.hasMore));
        setNextCursor(typeof payload?.nextCursor === 'string' ? payload.nextCursor : null);
        setCursorStack([null]);
        setSearched(false);
        setLastQuery('');
      } catch (e) {
        if (e?.name !== 'AbortError') {
          logError('[prints-search] recents', e);
        }
      } finally {
        setRecentsLoaded(true);
      }
    })();

    return () => controller.abort();
  }, [gateReady, hasAccess, gateToken, recentsLoaded]);

  const showingRange = useMemo(() => {
    if (results.length === 0) return '';
    const pageHint = hasMore ? ' · usá «Siguiente» para ver más' : '';
    if (!searched) return `Últimos ${results.length} PDFs${pageHint}`;
    return `Mostrando ${results.length} en esta página${pageHint}`;
  }, [searched, results.length, hasMore]);

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
      const fromPdf = resolvePreviewUrlFromPdfKey(SUPA_URL, key);
      if (fromPdf && !looksLikePdfUrl(fromPdf)) return fromPdf;
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
    () => results.map((row) => {
      const fromApi = typeof row.previewUrl === 'string' ? row.previewUrl.trim() : '';
      const fromApiSnake = typeof row.preview_url === 'string' ? row.preview_url.trim() : '';
      const direct = fromApi || fromApiSnake;
      const resolved = /^https?:\/\//i.test(direct)
        ? direct
        : getPreviewUrlFromRecord(row);
      return {
        ...row,
        previewUrl: resolved || null,
      };
    }),
    [results, getPreviewUrlFromRecord],
  );

  const fetchPrintsPage = useCallback(
    async ({
      queryText,
      cursor = null,
      nextOffset = 0,
      limit = PAGE_LIMIT,
      signal,
    }) => {
      const trimmed = String(queryText || '').trim();
      const params = new URLSearchParams({
        limit: String(limit),
      });
      if (trimmed) {
        params.set('query', trimmed);
      }
      if (Number.isFinite(nextOffset) && nextOffset >= 0) {
        params.set('offset', String(Math.floor(nextOffset)));
      }
      if (typeof cursor === 'string' && cursor.trim()) {
        params.set('cursor', cursor);
      }
      const endpoint = `/api/prints/search?${params.toString()}`;
      const headers = { Accept: 'application/json' };
      if (gateToken) {
        headers['X-Prints-Gate'] = gateToken;
      }
      const response = await apiFetch('GET', endpoint, undefined, {
        signal,
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
        setHasMore(false);
        setNextCursor(null);
        setSearched(false);
        return { ok: false };
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
        setLastQuery(trimmed);
        setHasMore(false);
        setNextCursor(null);
        return { ok: false };
      }

      let items = Array.isArray(payload?.items) ? payload.items : [];
      if (items.length > limit) {
        items = items.slice(0, limit);
      }
      setResults(items);
      setLastQuery(trimmed);
      setHasMore(Boolean(payload?.hasMore));
      setNextCursor(typeof payload?.nextCursor === 'string' ? payload.nextCursor : null);
      setRecentsLoaded(true);
      return { ok: true };
    },
    [gateToken],
  );

  async function performSearch(nextQuery, cursor = null, nextOffset = 0, { allowRecent = false } = {}) {
    const trimmed = String(nextQuery || '').trim();
    if (!trimmed && !allowRecent) {
      setError('Ingresá un término para buscar.');
      setResults([]);
      setHasMore(false);
      setNextCursor(null);
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
    if (trimmed) {
      setSearched(true);
    } else if (allowRecent) {
      setSearched(false);
    }

    try {
      await fetchPrintsPage({
        queryText: trimmed,
        cursor,
        nextOffset,
        signal: controller.signal,
      });
    } catch (requestError) {
      if (requestError?.name === 'AbortError') {
        return;
      }
      logError('[prints-search]', requestError);
      setError('Ocurrió un error al buscar en Supabase.');
      setResults([]);
      setHasMore(false);
      setNextCursor(null);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    setCursorStack([null]);
    performSearch(query, null, 0, { allowRecent: false });
  }

  function handlePrevious() {
    if (loading) return;
    if (cursorStack.length <= 1) return;
    const prevCursor = cursorStack[cursorStack.length - 2] ?? null;
    const inRecentMode = !searched;
    setCursorStack((current) => current.slice(0, -1));
    performSearch(
      lastQuery || query,
      prevCursor,
      Math.max(0, (cursorStack.length - 2) * PAGE_LIMIT),
      { allowRecent: inRecentMode },
    );
  }

  function handleNext() {
    if (loading) return;
    if (!hasMore || !nextCursor) return;
    const newStackIndex = cursorStack.length;
    const inRecentMode = !searched;
    setCursorStack((current) => [...current, nextCursor]);
    performSearch(
      lastQuery || query,
      nextCursor,
      Math.max(0, newStackIndex * PAGE_LIMIT),
      { allowRecent: inRecentMode },
    );
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
        performSearch(query, null, 0);
      }, 0);
    }
  }

  const canShowPagination = hasMore || cursorStack.length > 1;
  const hasResults = normalizedResults.length > 0;
  const noResultsMessage = searched && !loading && !hasResults && !error;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Buscar PDFs · NOTMID</title>
      </Helmet>
      <header className={styles.header}>
        <h1 className={styles.title}>Buscador de PDFs</h1>
        <p className={styles.description}>
          Ingresá el nombre, slug o medida para encontrar y descargar el PDF de producción.
        </p>
      </header>

      <section className={styles.panel}>
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
          <button type="submit" className={styles.btnPrimary} disabled={loading || !hasAccess}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        {error ? <p className={`${styles.feedback} ${styles.error}`}>{error}</p> : null}
      </section>

      <section className={`${styles.panel} ${styles.resultsPanel}`} aria-busy={loading}>
        <div className={styles.resultsToolbar}>
          <h2 className={styles.resultsHeading}>Archivos</h2>
          {loading ? (
            <p className={styles.resultsMeta}>Cargando…</p>
          ) : showingRange ? (
            <p className={styles.resultsMeta}>{showingRange}</p>
          ) : null}
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.resultsTable}>
            <thead>
              <tr>
                <th scope="col">Vista previa</th>
                <th scope="col">Archivo</th>
                <th scope="col">Medida</th>
                <th scope="col">Material</th>
                <th scope="col">Tamaño</th>
                <th scope="col">Descargar</th>
              </tr>
            </thead>
            <tbody>
              {hasResults ? (
                normalizedResults.map((row) => {
                  const { key, measurement, filename, downloadHref, previewSrc } = computePrintRowFields(row);
                  if (import.meta.env?.DEV) {
                    diag('[prints] preview', {
                      name: row.fileName || row.name,
                      preview: row.previewUrl,
                    });
                  }
                  const material = row.material || '-';
                  return (
                    <tr key={key}>
                      <td className={`${styles.previewCell} preview-cell`}>
                        <PreviewThumbnail src={previewSrc} />
                      </td>
                      <td className={styles.fileCell}>{row.fileName || row.name || '-'}</td>
                      <td className={styles.measureCell}>{measurement}</td>
                      <td className={styles.materialCell}>
                        {material !== '-' ? (
                          <span className={styles.materialPill}>{material}</span>
                        ) : (
                          <span className={styles.downloadMuted}>—</span>
                        )}
                      </td>
                      <td className={styles.sizeCell}>{formatBytes(row.sizeBytes ?? row.size)}</td>
                      <td>
                        {downloadHref ? (
                          <a
                            className={styles.downloadLink}
                            href={downloadHref}
                            download={filename}
                            target="_self"
                            rel="nofollow"
                          >
                            Descargar
                          </a>
                        ) : (
                          <span className={styles.downloadMuted}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className={styles.noResults} colSpan={6}>
                    {noResultsMessage ? 'No encontramos PDFs que coincidan.' : 'Sin resultados aún.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ul className={styles.cardList} role="list" aria-label="Lista de PDFs">
          {hasResults ? (
            normalizedResults.map((row) => {
              const { key, measurement, filename, downloadHref, previewSrc } = computePrintRowFields(row);
              const material = row.material || '-';
              const sizeStr = formatBytes(row.sizeBytes ?? row.size);
              return (
                <li key={key} className={styles.resultCard} role="listitem">
                  <PreviewThumbnail src={previewSrc} />
                  <div className={styles.resultCardMain}>
                    <p className={styles.resultCardTitle}>{row.fileName || row.name || '-'}</p>
                    <div className={styles.resultCardMeta}>
                      <span className={styles.metaChip}>{measurement}</span>
                      {material !== '-' ? (
                        <span className={styles.materialPill}>{material}</span>
                      ) : null}
                      <span className={styles.metaChip}>{sizeStr}</span>
                    </div>
                    <div className={styles.resultCardActions}>
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
                        <span className={styles.downloadMuted}>Sin enlace de descarga</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })
          ) : (
            <li className={styles.noResults}>
              {noResultsMessage ? 'No encontramos PDFs que coincidan.' : 'Sin resultados aún.'}
            </li>
          )}
        </ul>

        {canShowPagination ? (
          <div className={styles.pagination}>
            <button
              type="button"
              className={styles.btnOutline}
              onClick={handlePrevious}
              disabled={loading || cursorStack.length <= 1}
            >
              Anterior
            </button>
            <button
              type="button"
              className={styles.btnOutline}
              onClick={handleNext}
              disabled={loading || !hasMore || !nextCursor}
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
              <button type="submit" className={styles.btnPrimary} disabled={loading}>
                Ingresar
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
