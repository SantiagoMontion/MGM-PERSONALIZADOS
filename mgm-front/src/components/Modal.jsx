import styles from './Modal.module.css';

export default function Modal({ open, title, children, actions = [] }) {
  if (!open) return null;
  return (
    <div className={styles.overlay}>
      <div className={styles.box}>
        {title && <h3 className={styles.title}>{title}</h3>}
        <div>{children}</div>
        <div className={styles.actions}>
          {actions.map(({ label, onClick, disabled }) => (
            <button key={label} onClick={onClick} disabled={disabled}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
