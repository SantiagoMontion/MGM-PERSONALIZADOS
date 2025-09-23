import styles from './Toast.module.css';

export default function Toast({ message, actionLabel, onAction, onClose }) {
  if (!message) return null;
  return (
    <div className={styles.toast} role="status" aria-live="assertive">
      <span className={styles.message}>{message}</span>
      {actionLabel && onAction ? (
        <button type="button" className={styles.action} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Cerrar notificación"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
