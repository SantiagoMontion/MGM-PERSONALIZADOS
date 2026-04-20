import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SeoJsonLd from '../components/SeoJsonLd';
import {
  VOTACION_GALERIA_FOTOS,
  VOTACION_GALERIA_MAX_VOTOS,
} from '../lib/votacionesOptions.js';
import {
  fetchGaleriaCounts,
  fetchGaleriaMiCuenta,
  fetchGaleriaMisFotos,
  votarGaleriaFoto,
} from '../lib/votacionesApi.js';
import {
  clearGaleriaCompletedLocal,
  getOrCreateVoterUuid,
  getPublicIpHashHex,
  setGaleriaCompletedLocal,
} from '../lib/votacionVoterId.js';
import { isSupabaseConfigured } from '../lib/supa.js';
import styles from './Votaciones.module.css';

function mapRpcError(err) {
  const msg = String(err?.message || err || '');
  if (msg.includes('ya_votaste_esta_foto')) return 'Ya votaste esta foto.';
  if (msg.includes('max_votos')) return 'Ya usaste tus 5 votos.';
  if (msg.includes('ip_ya_voto')) return 'Desde esta red ya se votó esta foto.';
  if (msg.includes('foto_invalida')) return 'Esta opción no existe.';
  return 'No se pudo registrar el voto. Probá de nuevo.';
}

/** @typedef {{ id: string, src: string, titulo: string }} GaleriaFoto */

/** Inicio ventana 24h: 20/4/2026 00:00 · Fin: 21/4/2026 00:00 (hora local del navegador) */
const SORTEO_VENTANA_INICIO_MS = new Date(2026, 3, 20, 0, 0, 0).getTime();
const SORTEO_VENTANA_FIN_MS = new Date(2026, 3, 21, 0, 0, 0).getTime();

/**
 * Antes del 20/4 00:00: ms hasta el inicio del sorteo.
 * Entre el 20/4 00:00 y el 21/4 00:00: ms que faltan de las 24 horas.
 * Después del 21/4 00:00: 0.
 */
function getSorteoCountdownMs(now = Date.now()) {
  if (now < SORTEO_VENTANA_INICIO_MS) {
    return SORTEO_VENTANA_INICIO_MS - now;
  }
  return Math.max(0, SORTEO_VENTANA_FIN_MS - now);
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function Votaciones() {
  const navigate = useNavigate();
  const title = 'Sorteo Express 24hs | NOTMID';
  const description =
    'Sorteo Express 24 horas: votá a tus 5 favoritos. Tocá una foto para ampliarla.';
  const url = 'https://personalizados.notmid.ar/votaciones';

  const voterUuid = useMemo(() => getOrCreateVoterUuid(), []);
  const ipHashRef = useRef('');

  /** @type {[GaleriaFoto | null, (f: GaleriaFoto | null) => void]} */
  const [lightboxFoto, setLightboxFoto] = useState(null);

  const [misFotos, setMisFotos] = useState(() => new Set());
  const [miTotal, setMiTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState('');
  const [error, setError] = useState('');
  const [countdownMs, setCountdownMs] = useState(() => getSorteoCountdownMs());
  const [filtroNombre, setFiltroNombre] = useState('');
  const [votosRegistradosTotal, setVotosRegistradosTotal] = useState(0);

  const fotosFiltradas = useMemo(() => {
    const q = filtroNombre.trim().toLowerCase();
    if (!q) return VOTACION_GALERIA_FOTOS;
    return VOTACION_GALERIA_FOTOS.filter((f) =>
      f.titulo.toLowerCase().includes(q),
    );
  }, [filtroNombre]);

  const goLightboxPrev = useCallback(() => {
    setLightboxFoto((prev) => {
      if (!prev) return null;
      const i = fotosFiltradas.findIndex((f) => f.id === prev.id);
      if (i <= 0) return prev;
      return fotosFiltradas[i - 1];
    });
  }, [fotosFiltradas]);

  const goLightboxNext = useCallback(() => {
    setLightboxFoto((prev) => {
      if (!prev) return null;
      const i = fotosFiltradas.findIndex((f) => f.id === prev.id);
      if (i < 0 || i >= fotosFiltradas.length - 1) return prev;
      return fotosFiltradas[i + 1];
    });
  }, [fotosFiltradas]);

  const lightboxTouchStartRef = useRef({ x: 0, y: 0 });
  const lightboxSwipeIgnoreRef = useRef(false);

  const onLightboxTouchStart = useCallback((e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('button')) {
      lightboxSwipeIgnoreRef.current = true;
      return;
    }
    lightboxSwipeIgnoreRef.current = false;
    const touch = e.touches[0];
    if (!touch) return;
    lightboxTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const onLightboxTouchEnd = useCallback(
    (e) => {
      if (lightboxSwipeIgnoreRef.current) {
        lightboxSwipeIgnoreRef.current = false;
        return;
      }
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - lightboxTouchStartRef.current.x;
      const dy = touch.clientY - lightboxTouchStartRef.current.y;
      if (Math.abs(dx) < 48) return;
      if (Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) goLightboxNext();
      else goLightboxPrev();
    },
    [goLightboxNext, goLightboxPrev],
  );

  const syncEstado = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setVotosRegistradosTotal(0);
      setLoading(false);
      return;
    }
    try {
      const [cuenta, ids, countsRows] = await Promise.all([
        fetchGaleriaMiCuenta(voterUuid),
        fetchGaleriaMisFotos(voterUuid),
        fetchGaleriaCounts(),
      ]);
      setMiTotal(cuenta);
      setMisFotos(new Set(ids));
      setVotosRegistradosTotal(countsRows.reduce((acc, r) => acc + r.votos, 0));
      if (cuenta < VOTACION_GALERIA_MAX_VOTOS) {
        clearGaleriaCompletedLocal();
      }
      if (cuenta >= VOTACION_GALERIA_MAX_VOTOS) {
        setGaleriaCompletedLocal();
        navigate('/resultados', { replace: true });
      }
    } catch {
      setError(
        'No se pudieron cargar los datos. Revisá la migración SQL en Supabase (votacion_galeria).',
      );
    } finally {
      setLoading(false);
    }
  }, [navigate, voterUuid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await getPublicIpHashHex();
        if (!cancelled) ipHashRef.current = h;
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    syncEstado();
  }, [syncEstado]);

  useEffect(() => {
    const tick = () => setCountdownMs(getSorteoCountdownMs());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lightboxFoto) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setLightboxFoto(null);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goLightboxPrev();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goLightboxNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxFoto, goLightboxPrev, goLightboxNext]);

  useEffect(() => {
    if (!lightboxFoto) return;
    if (!fotosFiltradas.some((f) => f.id === lightboxFoto.id)) {
      setLightboxFoto(null);
    }
  }, [fotosFiltradas, lightboxFoto]);

  const cupoLleno = miTotal >= VOTACION_GALERIA_MAX_VOTOS;

  /**
   * @param {GaleriaFoto} foto
   */
  const handleVotar = async (foto) => {
    if (!foto || votingId || misFotos.has(foto.id) || cupoLleno) return;
    if (!isSupabaseConfigured) {
      setError('Configurá Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY) para votar.');
      return;
    }
    setVotingId(foto.id);
    setError('');
    try {
      const ip = ipHashRef.current || (await getPublicIpHashHex());
      ipHashRef.current = ip;
      const res = await votarGaleriaFoto(voterUuid, foto.id, ip);
      setMisFotos((prev) => new Set([...prev, foto.id]));
      setMiTotal(res.mis_votos);
      try {
        const rows = await fetchGaleriaCounts();
        setVotosRegistradosTotal(rows.reduce((acc, r) => acc + r.votos, 0));
      } catch {
        /* el contador global es secundario */
      }
      if (res.mis_votos >= VOTACION_GALERIA_MAX_VOTOS) {
        setGaleriaCompletedLocal();
        setLightboxFoto(null);
        navigate('/resultados', { replace: true });
      }
    } catch (e) {
      setError(mapRpcError(e));
      await syncEstado();
    } finally {
      setVotingId('');
    }
  };

  const voteLabel = (fotoId) => {
    if (misFotos.has(fotoId)) return 'Ya votaste';
    if (cupoLleno) return 'Sin votos';
    if (votingId === fotoId) return '…';
    return 'Votar';
  };

  const voteDisabled = (fotoId) =>
    !isSupabaseConfigured || Boolean(votingId) || misFotos.has(fotoId) || cupoLleno;

  const puedeVerResultados = miTotal >= VOTACION_GALERIA_MAX_VOTOS;

  const lightboxIdx = useMemo(() => {
    if (!lightboxFoto) return -1;
    return fotosFiltradas.findIndex((f) => f.id === lightboxFoto.id);
  }, [lightboxFoto, fotosFiltradas]);

  const lightboxPuedeAnterior = lightboxIdx > 0;
  const lightboxPuedeSiguiente =
    lightboxIdx >= 0 && lightboxIdx < fotosFiltradas.length - 1;

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
        <header className={styles.heroBanner}>
          <h1 className={styles.heroTitle}>SORTEO EXPRESS 24HS</h1>
          <p className={styles.heroTimer} aria-live="polite">{formatCountdown(countdownMs)}</p>
          <p className={styles.heroSubtitle}>VOTA A TUS 5 FAVORITOS</p>
          <p className={styles.heroTagline}>15 PREMIOS SELECCIONADOS DE NUESTRO OUTLET</p>
        </header>

        <p className={styles.hint}>
          Tus votos: {miTotal} / {VOTACION_GALERIA_MAX_VOTOS}
        </p>

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
            aria-label="Filtrar participantes por nombre"
          />
        </div>

        <p className={styles.participantCount}>
          Cantidad de votos registrados ({votosRegistradosTotal})
        </p>

        {!isSupabaseConfigured ? (
          <div className={styles.infoBox} role="status">
            Vista previa sin Supabase: definí <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> para guardar votos.
          </div>
        ) : null}

        {error ? <div className={styles.errorBox} role="alert">{error}</div> : null}

        {loading ? (
          <div className={styles.loading}>Cargando…</div>
        ) : (
          <>
            <div className={styles.grid}>
              {fotosFiltradas.map((f) => (
                <article key={f.id} className={styles.card}>
                  <button
                    type="button"
                    className={styles.cardMediaBtn}
                    onClick={() => setLightboxFoto(f)}
                    aria-label={`Ampliar: ${f.titulo}`}
                  >
                    <div className={styles.cardMedia}>
                      <img
                        className={`${styles.cardImg} ${misFotos.has(f.id) ? styles.cardImgVoted : ''}`.trim()}
                        src={f.src}
                        alt=""
                        loading="lazy"
                      />
                      {misFotos.has(f.id) ? (
                        <span className={styles.cardCheckOverlay} aria-hidden>✓</span>
                      ) : null}
                    </div>
                  </button>
                  <div className={styles.cardBody}>
                    <h2 className={styles.cardTitle}>{f.titulo}</h2>
                    <button
                      type="button"
                      className={styles.cardVoteBtn}
                      onClick={() => handleVotar(f)}
                      disabled={voteDisabled(f.id)}
                    >
                      {voteLabel(f.id)}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {fotosFiltradas.length === 0 ? (
              <p className={styles.searchEmpty} role="status">
                No hay participantes que coincidan con la búsqueda.
              </p>
            ) : null}

            <div className={styles.actions}>
              {puedeVerResultados ? (
                <Link className={styles.resultadosLink} to="/resultados">
                  Ver resultados
                </Link>
              ) : (
                <span
                  className={`${styles.resultadosLink} ${styles.resultadosLinkLocked}`.trim()}
                  aria-disabled="true"
                  title="Completá tus 5 votos para ver resultados"
                >
                  Ver resultados
                </span>
              )}
            </div>

            <p className={styles.conditionsNote}>
              Condiciones: El envio queda a cargo del ganador.
            </p>
            <p className={styles.conditionsNote}>
              La selección del mousepad será a elección de los participantes, se priorizarán a los ganadores que enviaron primero su foto.
            </p>
          </>
        )}
      </div>

      {lightboxFoto ? (
        <div
          className={styles.lightbox}
          role="presentation"
          onClick={() => setLightboxFoto(null)}
        >
          <div
            className={styles.lightboxRow}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.lightboxArrow}
              onClick={() => goLightboxPrev()}
              disabled={!lightboxPuedeAnterior}
              aria-label="Participante anterior"
            >
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
                <path
                  d="M15 6l-6 6 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div
              className={styles.lightboxDialog}
              role="dialog"
              aria-modal="true"
              aria-label={lightboxFoto.titulo}
              onTouchStart={onLightboxTouchStart}
              onTouchEnd={onLightboxTouchEnd}
            >
              <button
                type="button"
                className={styles.lightboxClose}
                onClick={() => setLightboxFoto(null)}
                aria-label="Cerrar"
              >
                ×
              </button>
              <div className={styles.lightboxCardInner}>
                <div className={styles.lightboxMediaBlock}>
                  <p className={styles.lightboxCaption}>{lightboxFoto.titulo}</p>
                  <div className={styles.lightboxFigure}>
                    <img
                      className={styles.lightboxImg}
                      src={lightboxFoto.src}
                      alt=""
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.voteBtn}
                  onClick={() => handleVotar(lightboxFoto)}
                  disabled={voteDisabled(lightboxFoto.id)}
                >
                  {voteLabel(lightboxFoto.id)}
                </button>
              </div>
            </div>
            <button
              type="button"
              className={styles.lightboxArrow}
              onClick={() => goLightboxNext()}
              disabled={!lightboxPuedeSiguiente}
              aria-label="Participante siguiente"
            >
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
                <path
                  d="M9 6l6 6-6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
