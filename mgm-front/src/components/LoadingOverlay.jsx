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
  title = 'Procesando tu pedido',
  subtitle,
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
      <div className={styles.card}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.message}>{currentMessage}</p>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
    </div>
  );
}
