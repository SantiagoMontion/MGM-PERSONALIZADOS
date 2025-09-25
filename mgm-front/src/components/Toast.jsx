import styles from './Toast.module.css';

export default function Toast({
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  onClose,
}) {
  if (!message) return null;
  return (
    <div className={styles.toast} role="status" aria-live="assertive">
      <span className={styles.message}>{message}</span>
      {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
        <div className={styles.actions}>
          {secondaryActionLabel && onSecondaryAction ? (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={onSecondaryAction}
            >
              {secondaryActionLabel}
            </button>
          ) : null}
          {actionLabel && onAction ? (
            <button type="button" className={styles.action} onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
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
