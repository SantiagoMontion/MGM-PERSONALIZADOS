import { useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from './PrintAreaHelpCaption.module.css';

const HELP_TEXT =
  'Cubre todo el mousepad con tu diseño, pero mantén lo importante dentro de la línea amarilla: lo que quede fuera de ese margen podría recortarse al fabricarlo.';

export default function PrintAreaHelpCaption({
  labelClassName = '',
  rowClassName = '',
  showHelp = false,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const popoverId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!showHelp || !open) return undefined;
    const onDoc = (event) => {
      if (wrapRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [close, open, showHelp]);

  useEffect(() => {
    if (!showHelp || !open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, open, showHelp]);

  return (
    <div
      ref={wrapRef}
      className={[styles.row, rowClassName].filter(Boolean).join(' ')}
    >
      <p className={labelClassName}>ÁREA DE IMPRESIÓN EXACTA</p>
      {showHelp ? (
        <span className={styles.helpWrap}>
          <button
            type="button"
            className={styles.helpButton}
            aria-label="Información sobre el área de impresión"
            aria-expanded={open}
            aria-controls={popoverId}
            onClick={() => setOpen((v) => !v)}
          >
            ?
          </button>
          {open ? (
            <div
              id={popoverId}
              className={styles.popover}
              role="tooltip"
            >
              {HELP_TEXT}
            </div>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
