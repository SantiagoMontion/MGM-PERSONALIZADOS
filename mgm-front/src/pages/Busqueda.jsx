import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { apiFetch } from '@/lib/api.js';
import styles from './Busqueda.module.css';

const STORAGE_KEY = 'mgmBusquedaAuth:v1';
const REQUIRED_PASSWORD = (import.meta.env.VITE_BUSQUEDA_PASSWORD || '').trim();

function readStoredAuth(passwordRequired) {
  if (!passwordRequired) return true;
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
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

function ResultCard({ item }) {
  const createdAt = formatDate(item.created_at);
  const sizeText = useMemo(() => {
    const w = Number(item.w_cm);
    const h = Number(item.h_cm);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      return `${w}×${h} cm`;
    }
    return null;
  }, [item.h_cm, item.w_cm]);
  const customerName = (item.customer_name || '').trim();
  const customerEmail = (item.customer_email || '').trim();
  const hasCustomer = customerName || customerEmail;

  return (
    <li className={styles.resultItem}>
      <div className={styles.resultHeader}>
        <div className={styles.resultTitleBlock}>
          <span className={styles.jobId}>{item.job_id}</span>
          <h3 className={styles.resultTitle}>{item.design_name || 'Sin nombre'}</h3>
          <p className={styles.resultMeta}>
            <span>{item.material || '—'}</span>
            {sizeText ? <span> · {sizeText}</span> : null}
          </p>
          {hasCustomer ? (
            <p className={styles.customerInfo}>
              Cliente: {customerName ? <span>{customerName}</span> : null}
              {customerName && customerEmail ? ' · ' : ''}
              {customerEmail ? (
                <a href={`mailto:${customerEmail}`} className={styles.customerEmail}>
                  {customerEmail}
                </a>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className={styles.resultDate}>
          <span>{createdAt}</span>
        </div>
      </div>
      <div className={styles.linksRow}>
        {item.file_original_url ? (
          <a className={styles.link} href={item.file_original_url} target="_blank" rel="noreferrer">
            Archivo original
          </a>
        ) : null}
        {item.print_jpg_url ? (
          <a className={styles.link} href={item.print_jpg_url} target="_blank" rel="noreferrer">
            Print JPG
          </a>
        ) : null}
        {item.pdf_url ? (
          <a className={styles.link} href={item.pdf_url} target="_blank" rel="noreferrer">
            PDF
          </a>
        ) : null}
        {item.preview_url ? (
          <a className={styles.link} href={item.preview_url} target="_blank" rel="noreferrer">
            Vista previa
          </a>
        ) : null}
      </div>
    </li>
  );
}

export default function Busqueda() {
  const passwordRequired = REQUIRED_PASSWORD.length > 0;
  const [isAuthorized, setIsAuthorized] = useState(() => readStoredAuth(passwordRequired));
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [term, setTerm] = useState('');
  const [lastTerm, setLastTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!passwordRequired) return;
    if (typeof window === 'undefined') return;
    if (isAuthorized) {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [isAuthorized, passwordRequired]);

  function handlePasswordSubmit(event) {
    event.preventDefault();
    if (!passwordRequired) {
      setIsAuthorized(true);
      return;
    }
    const candidate = passwordInput.trim();
    if (candidate && candidate === REQUIRED_PASSWORD) {
      setIsAuthorized(true);
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('Contraseña incorrecta.');
    }
  }

  async function handleSearch(event) {
    event.preventDefault();
    const cleanTerm = term.trim();
    if (!cleanTerm) {
      setError('Ingresá un término para buscar.');
      setResults([]);
      setLastTerm('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/search-assets?term=${encodeURIComponent(cleanTerm)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? String(payload.error) : `Error ${response.status}`;
        setError(message === 'missing_term' ? 'Ingresá un término para buscar.' : `No se pudo realizar la búsqueda (${message}).`);
        setResults([]);
        setLastTerm(cleanTerm);
      } else {
        setResults(Array.isArray(payload?.items) ? payload.items : []);
        setLastTerm(cleanTerm);
      }
    } catch (err) {
      setError(`No se pudo realizar la búsqueda. ${String(err?.message || err)}`);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  if (!isAuthorized) {
    return (
      <div className={styles.page}>
        <Helmet>
          <title>Búsqueda • MGM GAMERS</title>
        </Helmet>
        <h1 className={styles.heading}>Búsqueda interna</h1>
        <form className={styles.card} onSubmit={handlePasswordSubmit}>
          <p className={styles.description}>
            Ingresá la contraseña para acceder al buscador interno de archivos generados en Supabase.
          </p>
          {!passwordRequired ? (
            <p className={styles.passwordHint}>
              No hay contraseña configurada. Definí <code>VITE_BUSQUEDA_PASSWORD</code> para activar la protección.
            </p>
          ) : null}
          <label className={styles.label}>
            Contraseña
            <input
              className={styles.input}
              type="password"
              value={passwordInput}
              autoComplete="current-password"
              onChange={(event) => {
                setPasswordInput(event.target.value);
                if (passwordError) setPasswordError('');
              }}
            />
          </label>
          {passwordError ? <p className={styles.error}>{passwordError}</p> : null}
          <button type="submit" className={styles.primaryButton}>
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Búsqueda de archivos • MGM GAMERS</title>
      </Helmet>
      <h1 className={styles.heading}>Búsqueda de archivos</h1>
      <div className={styles.card}>
        <form className={styles.searchForm} onSubmit={handleSearch}>
          <label className={styles.label}>
            Término de búsqueda
            <input
              className={styles.input}
              type="search"
              placeholder="Nombre del diseño, material o ID"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              disabled={loading}
            />
          </label>
          <button type="submit" className={styles.primaryButton} disabled={loading}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        {error ? <p className={styles.error}>{error}</p> : null}
        {!error && lastTerm ? (
          <p className={styles.summary}>
            Mostrando <strong>{results.length}</strong> resultados para <mark className={styles.term}>&ldquo;{lastTerm}&rdquo;</mark>
          </p>
        ) : null}
        {results.length > 0 ? (
          <ul className={styles.resultsList}>
            {results.map((item, index) => {
              const key =
                item.job_id ||
                item.file_original_url ||
                item.preview_url ||
                item.pdf_url ||
                item.print_jpg_url ||
                `resultado-${index}`;
              return <ResultCard key={key} item={item} />;
            })}
          </ul>
        ) : null}
        {!loading && !error && lastTerm && results.length === 0 ? (
          <p className={styles.emptyState}>No se encontraron resultados para ese término.</p>
        ) : null}
      </div>
    </div>
  );
}
