import { useEffect, useMemo, useState } from 'react';
import styles from './LoadingOverlay.module.css';

const DEFAULT_STEPS = [
  'Guardando cambios...',
  'Creando tu pedido...',
  'Últimos detalles...'
];

export default function LoadingOverlay({
  show,
  visible,
  messages = [],
  steps = [],
  intervalMs = 2000,
  subtitle = 'Esto puede demorar unos segundos',
}) {
  const isVisible = typeof visible === 'boolean' ? visible : Boolean(show);
  const sequence = useMemo(() => {
    const explicitSteps = Array.isArray(steps) ? steps : [];
    const explicitMessages = Array.isArray(messages) ? messages : [];
    const list = [...explicitSteps, ...explicitMessages].filter(
      (entry) => typeof entry === 'string' && entry.trim().length > 0,
    );
    if (list.length > 0) {
      return list;
    }
    return DEFAULT_STEPS;
  }, [messages, steps]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isVisible) {
      setIndex(0);
      return undefined;
    }
    if (sequence.length <= 1) {
      setIndex(0);
      return undefined;
    }
    const delay = Number.isFinite(intervalMs) && intervalMs > 250 ? intervalMs : 2000;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % sequence.length);
    }, delay);
    return () => clearInterval(id);
  }, [intervalMs, isVisible, sequence.length]);

  if (!isVisible) {
    return null;
  }

  const currentMessage = sequence[index] || sequence[0] || 'Cargando…';

  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.panel}>
        <svg viewBox="0 0 50 50" width="64" height="64" className={styles.spinner}>
          <circle cx="25" cy="25" r="20" stroke="rgba(255, 255, 255, 0.3)" strokeWidth="5" fill="none" />
          <circle
            cx="25"
            cy="25"
            r="20"
            stroke="#fff"
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
            strokeDasharray="31.4 188.4"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 25 25"
              to="360 25 25"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
        <div className={styles.message}>{currentMessage}</div>
        {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
      </div>
    </div>
  );
}
