import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { apiFetch } from '@/lib/api.js';
import styles from './Busqueda.module.css';

const PAGE_LIMIT = 25;

function formatBytes(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current < 10 && index > 0 ? current.toFixed(1) : Math.round(current)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '—';
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

export default function Busqueda() {
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

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

    setLoading(true);
    setError('');
    setSearched(true);

    try {
      const params = new URLSearchParams({
        query: trimmed,
        limit: String(PAGE_LIMIT),
        offset: String(Math.max(0, nextOffset)),
      });
      const response = await apiFetch(`/api/outputs/search?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof payload?.message === 'string'
          ? payload.message
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
      const pagination = payload?.pagination || {};
      const totalItems = Number(pagination?.total) || items.length;
      const usedOffset = Number(pagination?.offset) || nextOffset;

      setResults(items);
      setTotal(totalItems);
      setOffset(usedOffset);
      setLastQuery(trimmed);
    } catch (requestError) {
      console.error('[outputs-search]', requestError);
      setError('Ocurrió un error al buscar en Supabase.');
      setResults([]);
      setTotal(0);
    } finally {
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
          Ingresá el nombre del archivo (sin la extensión) para encontrar y descargar el PDF imprimible.
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
              placeholder="Buscar por nombre de archivo, sin extensión…"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={loading}
            />
          </div>
          <button type="submit" className={styles.searchButton} disabled={loading}>
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
                <th scope="col">Archivo</th>
                <th scope="col">Tamaño</th>
                <th scope="col">Fecha</th>
                <th scope="col">Descargar</th>
              </tr>
            </thead>
            <tbody>
              {hasResults ? (
                results.map((item) => (
                  <tr key={item.path}>
                    <td className={styles.fileCell}>{item.name || '—'}</td>
                    <td className={styles.sizeCell}>{formatBytes(item.size)}</td>
                    <td className={styles.dateCell}>{formatDate(item.createdAt)}</td>
                    <td>
                      {item.downloadUrl ? (
                        <a
                          className={styles.downloadLink}
                          href={item.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Descargar
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className={styles.noResults} colSpan={4}>
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
    </div>
  );
}
