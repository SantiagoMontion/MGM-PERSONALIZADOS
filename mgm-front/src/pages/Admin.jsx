import { useEffect, useRef, useState } from 'react';
import { useAdminToken } from '../hooks/useAdminToken';
import { searchJobs } from '../lib/adminClient';
import styles from './Admin.module.css';

export default function Admin() {
  const { token, saveToken, clearToken } = useAdminToken();
  const [tokenInput, setTokenInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasPdf, setHasPdf] = useState(false);
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTime, setSearchTime] = useState(0);

  const searchRef = useRef(null);
  const pageSize = 25;

  useEffect(() => {
    function handleKey(e) {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape') {
        setQ('');
        searchRef.current?.focus();
      } else if (e.key === 'Enter' && document.activeElement === searchRef.current) {
        doSearch(1);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  async function doSearch(p) {
    if (!token) return;
    setLoading(true);
    setError('');
    const t0 = performance.now();
    const { res, data } = await searchJobs(token, {
      q,
      status,
      date_from: dateFrom,
      date_to: dateTo,
      has_pdf: hasPdf ? 'true' : undefined,
      page: p,
    });
    const elapsed = performance.now() - t0;
    setSearchTime(Math.round(elapsed));
    if (res.status === 401) {
      clearToken();
      alert('Token inválido');
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(`${data.error || 'error'} diag_id=${data.diag_id || '-'}`);
      setLoading(false);
      return;
    }
    setResults(data.results || []);
    setTotal(data.total || 0);
    setPage(data.page || p);
    setLoading(false);
  }

  if (!token) {
    return (
      <div className={styles.container}>
        <div className={styles.tokenPrompt}>
          <input
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            placeholder="Admin Token"
          />
          <button onClick={() => saveToken(tokenInput.trim())}>Guardar</button>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className={styles.container}>
      <div className={styles.searchBar}>
        <input
          ref={searchRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar"
        />
        <input
          value={status}
          onChange={e => setStatus(e.target.value)}
          placeholder="status"
        />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <label>
          <input
            type="checkbox"
            checked={hasPdf}
            onChange={e => setHasPdf(e.target.checked)}
          />
          con PDF
        </label>
        <button onClick={() => doSearch(1)}>Buscar</button>
      </div>
      {loading && <div>Buscando...</div>}
      <div>
        {total} resultados{searchTime ? ` en ${searchTime}ms` : ''}
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Job ID</th>
            <th>Diseño</th>
            <th>Medida</th>
            <th>Material</th>
            <th>Cliente</th>
            <th>Status</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>
                {r.job_id}
                <button onClick={() => navigator.clipboard.writeText(r.job_id)}>📋</button>
              </td>
              <td>{r.design_name}</td>
              <td>{r.w_cm}×{r.h_cm}</td>
              <td>{r.material}</td>
              <td>{r.customer_email}</td>
              <td>{r.status}</td>
              <td className={styles.actions}>
                {r.pdf_download_url && (
                  <a href={r.pdf_download_url} target="_blank" rel="noreferrer" download>PDF</a>
                )}
                {r.print_jpg_download_url && (
                  <a href={r.print_jpg_download_url} target="_blank" rel="noreferrer" download>JPG</a>
                )}
                {r.preview_url && (
                  <a href={r.preview_url} target="_blank" rel="noreferrer">Preview</a>
                )}
                {r.shopify_product_url && (
                  <a href={r.shopify_product_url} target="_blank" rel="noreferrer">Shopify</a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.pagination}>
        <button disabled={page <= 1} onClick={() => doSearch(page - 1)}>
          Anterior
        </button>
        <span>
          {page}/{totalPages}
        </span>
        <button disabled={page >= totalPages} onClick={() => doSearch(page + 1)}>
          Siguiente
        </button>
        <button onClick={clearToken}>Cambiar token</button>
      </div>
    </div>
  );
}
