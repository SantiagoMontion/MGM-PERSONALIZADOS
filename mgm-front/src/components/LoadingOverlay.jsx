import { useEffect, useState } from 'react';
import styles from './LoadingOverlay.module.css';

export default function LoadingOverlay({ show, messages = [] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!show || messages.length === 0) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % messages.length);
    }, 2000);
    return () => clearInterval(id);
  }, [show, messages.length]);

  if (!show) return null;

  return (
    <div className={styles.overlay}>
      <div className={`spinner ${styles.spinnerSpacing}`} />
      <p className={styles.message}>{messages[index] || 'Cargando…'}</p>
    </div>
  );
}
