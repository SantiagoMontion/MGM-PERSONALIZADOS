export default function Modal({ open, title, children, actions = [] }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#2d2d2d',
        padding: 24,
        borderRadius: 12,
        width: '90%',
        maxWidth: 360,
        color: '#fff'
      }}>
        {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
        <div>{children}</div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
