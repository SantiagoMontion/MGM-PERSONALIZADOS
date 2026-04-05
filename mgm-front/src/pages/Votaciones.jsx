import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import SeoJsonLd from '../components/SeoJsonLd';
import {
  VOTACION_MAX_VOTOS,
  VOTACION_OPCIONES,
  VOTACION_OTROS_CARD,
  VOTACION_OTROS_MAX_CHARS,
  VOTACION_SESSION_KEY,
} from '../lib/votacionesOptions.js';
import {
  fetchVotacionCounts,
  incrementOtro,
  incrementVoto,
} from '../lib/votacionesApi.js';
import { isSupabaseConfigured } from '../lib/supa.js';
import styles from './Votaciones.module.css';

const PRESET_IDS = new Set(VOTACION_OPCIONES.map((o) => o.id));

const OTROS_PLACEHOLDER_MOBILE = 'Mouse (marca)';
const OTROS_PLACEHOLDER_DESKTOP = 'Ej: Mouse y teclado (marca)';

/** @typedef {{ kind: 'preset', id: string } | { kind: 'otros', text: string }} VotacionPick */

/** @param {unknown[]} raw */
function normalizePicks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string' && PRESET_IDS.has(item)) {
      out.push({ kind: 'preset', id: item });
    } else if (item && typeof item === 'object' && item.kind === 'preset' && PRESET_IDS.has(item.id)) {
      out.push({ kind: 'preset', id: item.id });
    } else if (item && typeof item === 'object' && item.kind === 'otros' && typeof item.text === 'string') {
      const t = item.text.trim().slice(0, VOTACION_OTROS_MAX_CHARS);
      if (t.length >= 1) out.push({ kind: 'otros', text: t });
    }
  }
  return out.slice(0, VOTACION_MAX_VOTOS);
}

/** @returns {VotacionPick[]} si ya se enviaron votos en esta sesión (1 a VOTACION_MAX_VOTOS) */
function loadCompletedSessionPicks() {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(VOTACION_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const picks = normalizePicks(parsed?.picks || []);
    if (parsed?.submitted === true && picks.length >= 1) return picks;
    /* Compat: sesiones viejas sin `submitted` pero con 3 picks */
    if (picks.length >= VOTACION_MAX_VOTOS) return picks;
    return [];
  } catch {
    return [];
  }
}

/** @param {VotacionPick[]} picks — entre 1 y VOTACION_MAX_VOTOS ítems */
function saveCompletedSessionPicks(picks) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      VOTACION_SESSION_KEY,
      JSON.stringify({ picks, updatedAt: Date.now(), submitted: true }),
    );
  } catch {
    /* ignore quota */
  }
}

/** @param {VotacionPick[]} picks */
function hasPickedPreset(picks, id) {
  return picks.some((p) => p.kind === 'preset' && p.id === id);
}

/** @param {VotacionPick[]} picks */
function otrosPickCount(picks) {
  return picks.filter((p) => p.kind === 'otros').length;
}

export default function Votaciones() {
  const title = 'Próximos ingresos: Vos decidís. | NOTMID';
  const description =
    'Queremos que la tienda tenga exactamente lo que buscás. Votá por tus productos favoritos (o sugerí uno nuevo).';
  const url = 'https://personalizados.notmid.ar/votaciones';

  const [presetCounts, setPresetCounts] = useState(() => {
    const initial = {};
    for (const o of VOTACION_OPCIONES) initial[o.id] = 0;
    return initial;
  });
  const [otrosRows, setOtrosRows] = useState(() => []);
  const [resultsMode, setResultsMode] = useState(
    () => loadCompletedSessionPicks().length >= 1,
  );
  const [draftPicks, setDraftPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [otrosFlipped, setOtrosFlipped] = useState(false);
  const [otrosDraft, setOtrosDraft] = useState('');
  const [otrosPlaceholder, setOtrosPlaceholder] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
      ? OTROS_PLACEHOLDER_MOBILE
      : OTROS_PLACEHOLDER_DESKTOP,
  );
  const otrosInputRef = useRef(null);

  const showResults = resultsMode;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => {
      setOtrosPlaceholder(mq.matches ? OTROS_PLACEHOLDER_MOBILE : OTROS_PLACEHOLDER_DESKTOP);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const refreshCounts = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError('');
      return;
    }
    try {
      const { presets, otros } = await fetchVotacionCounts();
      setPresetCounts((prev) => {
        const next = { ...prev };
        for (const o of VOTACION_OPCIONES) {
          if (presets[o.id] != null) next[o.id] = presets[o.id];
        }
        return next;
      });
      setOtrosRows(Array.isArray(otros) ? otros : []);
      setError('');
    } catch (e) {
      setError(
        'No se pudieron cargar los votos. Verificá tablas y funciones SQL (scripts/votaciones_supabase_setup.sql).',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const totalVotos = useMemo(() => {
    let t = 0;
    for (const o of VOTACION_OPCIONES) t += Number(presetCounts[o.id]) || 0;
    for (const row of otrosRows) t += Number(row.votos) || 0;
    return t;
  }, [presetCounts, otrosRows]);

  useEffect(() => {
    if (otrosFlipped && otrosInputRef.current) {
      const id = requestAnimationFrame(() => {
        otrosInputRef.current?.focus?.();
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [otrosFlipped]);

  useEffect(() => {
    if (showResults || draftPicks.length >= VOTACION_MAX_VOTOS) {
      setOtrosFlipped(false);
    }
  }, [showResults, draftPicks.length]);

  const togglePreset = (optionId) => {
    if (showResults || submitting) return;
    setDraftPicks((prev) => {
      if (hasPickedPreset(prev, optionId)) {
        return prev.filter((p) => !(p.kind === 'preset' && p.id === optionId));
      }
      if (prev.length >= VOTACION_MAX_VOTOS) return prev;
      return [...prev, { kind: 'preset', id: optionId }];
    });
  };

  const removeOtroPick = (text) => {
    if (showResults || submitting) return;
    setDraftPicks((prev) => prev.filter((p) => !(p.kind === 'otros' && p.text === text)));
  };

  const handleConfirmOtro = (e) => {
    e.preventDefault();
    const trimmed = otrosDraft.trim().slice(0, VOTACION_OTROS_MAX_CHARS);
    if (!trimmed.length) return;
    if (showResults || submitting) return;
    if (draftPicks.length >= VOTACION_MAX_VOTOS) return;
    if (draftPicks.some((p) => p.kind === 'otros' && p.text === trimmed)) return;

    setDraftPicks((prev) => [...prev, { kind: 'otros', text: trimmed }]);
    setOtrosDraft('');
    setOtrosFlipped(false);
  };

  const handleVerResultados = async () => {
    if (showResults || submitting) return;
    if (draftPicks.length < 1) return;
    if (!isSupabaseConfigured) {
      setError('Configurá Supabase en el entorno para enviar los votos.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      for (const pick of draftPicks) {
        if (pick.kind === 'preset') {
          await incrementVoto(pick.id);
        } else {
          await incrementOtro(pick.text);
        }
      }

      saveCompletedSessionPicks(draftPicks);
      setResultsMode(true);
      await refreshCounts();
    } catch {
      setError(
        'No se pudieron registrar los votos. Revisá las funciones RPC y RLS en Supabase.',
      );
      await refreshCounts();
    } finally {
      setSubmitting(false);
    }
  };

  const closeOtrosFlip = () => {
    setOtrosFlipped(false);
    setOtrosDraft('');
  };

  const draftFull = draftPicks.length >= VOTACION_MAX_VOTOS;

  const topRow = VOTACION_OPCIONES.slice(0, 3);
  const bottomRow = [...VOTACION_OPCIONES.slice(3, 5), VOTACION_OTROS_CARD];

  const otrosFlipDisabled = showResults || submitting || draftFull;
  const otrosOuterLocked = showResults || submitting;
  const otrosPicked = otrosPickCount(draftPicks) > 0;

  const resultsOtrosSorted = useMemo(
    () => [...otrosRows].sort((a, b) => (Number(b.votos) || 0) - (Number(a.votos) || 0)),
    [otrosRows],
  );

  const draftOtrosTexts = useMemo(
    () => draftPicks.filter((p) => p.kind === 'otros').map((p) => p.text),
    [draftPicks],
  );

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
        {showResults ? (
          <h1 className={styles.title}>Resultados</h1>
        ) : (
          <>
            <h1 className={styles.title}>Próximos ingresos: Vos decidís.</h1>
            <p className={styles.subtitle}>
              Queremos que la tienda tenga exactamente lo que buscás. Votá por tus productos favoritos (o sugerí uno nuevo).
            </p>
          </>
        )}

        {!showResults && (
          <p className={styles.hint}>
            Seleccionados: {draftPicks.length} / {VOTACION_MAX_VOTOS}
          </p>
        )}

        {!isSupabaseConfigured ? (
          <div className={styles.infoBox} role="status">
            Vista previa sin Supabase: definí <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> en el entorno (p. ej. Vercel) para guardar votos en vivo.
          </div>
        ) : null}

        {error ? <div className={styles.errorBox} role="alert">{error}</div> : null}

        {loading ? (
          <div className={styles.loading}>Cargando conteos…</div>
        ) : null}

        {!showResults && (
          <>
            <div className={styles.grid} aria-busy={submitting}>
              {topRow.map((opt) => {
                const picked = hasPickedPreset(draftPicks, opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`${styles.card} ${styles.cardTop} ${picked ? styles.cardPicked : ''}`.trim()}
                    onClick={() => togglePreset(opt.id)}
                    disabled={showResults || submitting}
                  >
                    <div className={styles.cardMedia}>
                      <img
                        className={`${styles.cardImg} ${picked ? styles.cardImgPicked : ''}`.trim()}
                        src={opt.imagen}
                        alt=""
                        loading="lazy"
                      />
                      {picked ? (
                        <span className={styles.cardCheckOverlay} aria-hidden>✓</span>
                      ) : null}
                    </div>
                    <div className={styles.cardBody}>
                      <h2 className={styles.cardTitle}>{opt.titulo}</h2>
                    </div>
                  </button>
                );
              })}
              {bottomRow.map((opt) => (
                opt.id === VOTACION_OTROS_CARD.id ? (
                  <div
                    key={opt.id}
                    className={`${styles.flipWrap} ${styles.cardBottom}`.trim()}
                  >
                    <div
                      className={`${styles.flipOuter} ${otrosPicked ? styles.flipOuterPicked : ''} ${otrosOuterLocked ? styles.flipOuterDisabled : ''}`.trim()}
                    >
                      <div
                        className={`${styles.flipInner} ${otrosFlipped ? styles.flipInnerActive : ''}`.trim()}
                      >
                        <div className={`${styles.flipFace} ${styles.flipFront}`}>
                          <div className={styles.flipFrontStack}>
                            <button
                              type="button"
                              className={styles.flipFrontBtn}
                              disabled={otrosFlipDisabled}
                              onClick={() => {
                                if (!otrosFlipDisabled) setOtrosFlipped(true);
                              }}
                            >
                              <div className={styles.cardMedia}>
                                <img
                                  className={`${styles.cardImg} ${otrosPicked ? styles.cardImgPicked : ''}`.trim()}
                                  src={opt.imagen}
                                  alt=""
                                  loading="lazy"
                                />
                                {otrosPicked ? (
                                  <span className={styles.cardCheckOverlay} aria-hidden>✓</span>
                                ) : null}
                              </div>
                              <div className={styles.cardBody}>
                                <h2 className={styles.cardTitle}>{opt.titulo}</h2>
                                {!otrosPicked ? (
                                  <span className={styles.otrosFrontHint}>Tocá para indicar</span>
                                ) : null}
                              </div>
                            </button>
                            {draftOtrosTexts.length > 0 ? (
                              <div className={styles.otrosChips}>
                                {draftOtrosTexts.map((t) => (
                                  <span key={t} className={styles.otrosChip}>
                                    <span className={styles.otrosChipText}>{t}</span>
                                    <button
                                      type="button"
                                      className={styles.otrosChipRemove}
                                      disabled={submitting}
                                      onClick={() => removeOtroPick(t)}
                                      aria-label={`Quitar «${t}»`}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div
                          className={`${styles.flipFace} ${styles.flipBack}`}
                          style={{
                            '--otros-card-bg': `url(${JSON.stringify(opt.imagen)})`,
                          }}
                        >
                          <p className={styles.otrosLabel}>¿Qué traemos?</p>
                          <form onSubmit={handleConfirmOtro}>
                            <input
                              ref={otrosInputRef}
                              className={styles.otrosInput}
                              type="text"
                              maxLength={VOTACION_OTROS_MAX_CHARS}
                              value={otrosDraft}
                              onChange={(ev) => setOtrosDraft(ev.target.value.slice(0, VOTACION_OTROS_MAX_CHARS))}
                              placeholder={otrosPlaceholder}
                              autoComplete="off"
                              disabled={submitting}
                              aria-label="Qué productos te gustaría que traigamos"
                            />
                            <p className={styles.otrosCharCount}>
                              {otrosDraft.length}/{VOTACION_OTROS_MAX_CHARS}
                            </p>
                            <div className={styles.otrosActions}>
                              <button
                                type="button"
                                className={styles.otrosBtnGhost}
                                onClick={closeOtrosFlip}
                                disabled={submitting}
                              >
                                Volver
                              </button>
                              <button
                                type="submit"
                                className={styles.otrosBtnPrimary}
                                disabled={
                                  submitting
                                  || !otrosDraft.trim()
                                  || draftPicks.length >= VOTACION_MAX_VOTOS
                                }
                              >
                                Agregar selección
                              </button>
                            </div>
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    key={opt.id}
                    type="button"
                    className={`${styles.card} ${styles.cardBottom} ${hasPickedPreset(draftPicks, opt.id) ? styles.cardPicked : ''}`.trim()}
                    onClick={() => togglePreset(opt.id)}
                    disabled={showResults || submitting}
                  >
                    <div className={styles.cardMedia}>
                      <img
                        className={`${styles.cardImg} ${hasPickedPreset(draftPicks, opt.id) ? styles.cardImgPicked : ''}`.trim()}
                        src={opt.imagen}
                        alt=""
                        loading="lazy"
                      />
                      {hasPickedPreset(draftPicks, opt.id) ? (
                        <span className={styles.cardCheckOverlay} aria-hidden>✓</span>
                      ) : null}
                    </div>
                    <div className={styles.cardBody}>
                      <h2 className={styles.cardTitle}>{opt.titulo}</h2>
                    </div>
                  </button>
                )
              ))}
            </div>

            <div className={styles.verResultadosWrap}>
              <button
                type="button"
                className={styles.verResultadosBtn}
                onClick={handleVerResultados}
                disabled={draftPicks.length < 1 || submitting}
              >
                {submitting ? 'Enviando…' : 'Ver resultados'}
              </button>
            </div>
          </>
        )}

        {showResults && (
          <div className={styles.resultsBlock}>
            <h2 className={styles.resultsTitle}>Esto es lo que quiere la gente</h2>
            {VOTACION_OPCIONES.map((opt) => {
              const n = Number(presetCounts[opt.id]) || 0;
              const pct = totalVotos > 0 ? Math.round((n / totalVotos) * 1000) / 10 : 0;
              return (
                <div key={opt.id} className={styles.barRow}>
                  <div className={styles.barLabel}>{opt.titulo}</div>
                  <div className={styles.barTrack} aria-hidden="true">
                    <div
                      className={styles.barFill}
                      style={{ width: `${totalVotos > 0 ? (n / totalVotos) * 100 : 0}%` }}
                    />
                  </div>
                  <div className={styles.barStats}>
                    {pct}% · {n} {n === 1 ? 'voto' : 'votos'}
                  </div>
                </div>
              );
            })}
            {resultsOtrosSorted.map((row) => {
              const n = Number(row.votos) || 0;
              const pct = totalVotos > 0 ? Math.round((n / totalVotos) * 1000) / 10 : 0;
              const label = `Otros (“${row.texto}”)`;
              return (
                <div key={`otros-${row.texto}`} className={styles.barRow}>
                  <div className={styles.barLabel}>{label}</div>
                  <div className={styles.barTrack} aria-hidden="true">
                    <div
                      className={styles.barFill}
                      style={{ width: `${totalVotos > 0 ? (n / totalVotos) * 100 : 0}%` }}
                    />
                  </div>
                  <div className={styles.barStats}>
                    {pct}% · {n} {n === 1 ? 'voto' : 'votos'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
