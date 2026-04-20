import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

/** @typedef {{ id: string, src: string, titulo: string, votos?: number }} GaleriaFotoRow */
import SeoJsonLd from '../components/SeoJsonLd';
import { VOTACION_GALERIA_FOTOS } from '../lib/votacionesOptions.js';
import { fetchGaleriaCounts } from '../lib/votacionesApi.js';
import { isGaleriaCompletedLocal } from '../lib/votacionVoterId.js';
import { isSupabaseConfigured } from '../lib/supa.js';
import styles from './ResultadosVotaciones.module.css';

export default function ResultadosVotaciones() {
  const title = 'Resultados de la votación | NOTMID';
  const description = 'Totales en vivo de la galería.';
  const url = 'https://personalizados.notmid.ar/resultados';

  const [countsById, setCountsById] = useState(() => {
    const m = {};
    for (const f of VOTACION_GALERIA_FOTOS) m[f.id] = 0;
    return m;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtroNombre, setFiltroNombre] = useState('');
  /** @type {[GaleriaFotoRow | null, (f: GaleriaFotoRow | null) => void]} */
  const [lightboxFoto, setLightboxFoto] = useState(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const rows = await fetchGaleriaCounts();
      setCountsById((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.id] = r.votos;
        return next;
      });
      setError('');
    } catch {
      setError('No se pudieron cargar los resultados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!lightboxFoto) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightboxFoto(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxFoto]);

  const rowsWithVotos = useMemo(
    () =>
      VOTACION_GALERIA_FOTOS.map((f) => ({
        ...f,
        votos: Number(countsById[f.id]) || 0,
      })),
    [countsById],
  );

  const rowsSorted = useMemo(() => {
    return [...rowsWithVotos].sort((a, b) => {
      if (b.votos !== a.votos) return b.votos - a.votos;
      return a.titulo.localeCompare(b.titulo, 'es');
    });
  }, [rowsWithVotos]);

  const filasMostradas = useMemo(() => {
    const q = filtroNombre.trim().toLowerCase();
    if (!q) return rowsSorted;
    return rowsSorted.filter((r) => r.titulo.toLowerCase().includes(q));
  }, [rowsSorted, filtroNombre]);

  const totalVotos = useMemo(
    () => rowsWithVotos.reduce((acc, r) => acc + r.votos, 0),
    [rowsWithVotos],
  );
  const maxVotos = useMemo(
    () => rowsWithVotos.reduce((acc, r) => (r.votos > acc ? r.votos : acc), 0),
    [rowsWithVotos],
  );

  const yaCompletoLocal = typeof window !== 'undefined' && isGaleriaCompletedLocal();

  return (
    <>
      <SeoJsonLd
        title={title}
        description={description}
        canonical={url}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          url,
        }}
      />
      <div className={styles.page}>
        <h1 className={styles.title}>Resultados</h1>
        <p className={styles.lead}>
          {totalVotos === 0 && !loading
            ? 'Todavía no hay votos registrados. Cuando la gente vote, vas a ver los porcentajes acá.'
            : 'Totales por foto (se actualizan al recargar la página).'}
        </p>

        {!isSupabaseConfigured ? (
          <div className={styles.infoBox} role="status">
            Sin Supabase no hay totales en vivo. Configurá las variables de entorno para producción.
          </div>
        ) : null}

        {error ? <div className={styles.errorBox} role="alert">{error}</div> : null}

        <div className={styles.searchWrap}>
          <span className={styles.searchIcon} aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path
                d="M16 16l4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            type="search"
            className={styles.searchInput}
            value={filtroNombre}
            onChange={(e) => setFiltroNombre(e.target.value)}
            placeholder="Buscar por nombre…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Filtrar resultados por nombre"
          />
        </div>

        <p className={styles.participantCount}>
          Cantidad de votos registrados ({totalVotos})
        </p>

        {loading ? (
          <div className={styles.loading}>Cargando…</div>
        ) : (
          <>
            <div className={styles.resultsBlock}>
              {filasMostradas.map((row) => {
                const n = row.votos;
                const pct = totalVotos > 0 ? Math.round((n / totalVotos) * 1000) / 10 : 0;
                return (
                  <div key={row.id} className={styles.barRow}>
                    <button
                      type="button"
                      className={styles.thumbBtn}
                      onClick={() => setLightboxFoto(row)}
                      aria-label={`Ver foto grande: ${row.titulo}`}
                    >
                      <img className={styles.thumbImg} src={row.src} alt="" loading="lazy" />
                    </button>
                    <div className={styles.barLabel}>{row.titulo}</div>
                    <div className={styles.barTrack} aria-hidden="true">
                      <div
                        className={styles.barFill}
                        style={{ width: `${maxVotos > 0 ? (n / maxVotos) * 100 : 0}%` }}
                      />
                    </div>
                    <div className={styles.barStats}>
                      {pct}% · {n} {n === 1 ? 'voto' : 'votos'}
                    </div>
                  </div>
                );
              })}
            </div>
            {filasMostradas.length === 0 && rowsSorted.length > 0 ? (
              <p className={styles.searchEmpty} role="status">
                No hay participantes que coincidan con la búsqueda.
              </p>
            ) : null}
          </>
        )}

        <div className={styles.footerNav}>
          {yaCompletoLocal ? (
            <Link className={styles.backLink} to="/">
              Ir al inicio
            </Link>
          ) : (
            <Link className={styles.backLink} to="/votaciones">
              Volver a votar
            </Link>
          )}
        </div>
      </div>

      {lightboxFoto ? (
        <div
          className={styles.lightbox}
          role="presentation"
          onClick={() => setLightboxFoto(null)}
        >
          <div
            className={styles.lightboxDialog}
            role="dialog"
            aria-modal="true"
            aria-label={lightboxFoto.titulo}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.lightboxClose}
              onClick={() => setLightboxFoto(null)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <div className={styles.lightboxFigure}>
              <img
                className={styles.lightboxImg}
                src={lightboxFoto.src}
                alt={lightboxFoto.titulo}
              />
            </div>
            <p className={styles.lightboxCaption}>{lightboxFoto.titulo}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
