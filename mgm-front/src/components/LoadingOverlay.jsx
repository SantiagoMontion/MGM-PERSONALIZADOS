import { useEffect, useState } from 'react';

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
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      zIndex: 1000,
    }}>
      <div className="spinner" style={{ marginBottom: 16 }} />
      <p style={{ fontSize: 16 }}>{messages[index] || 'Cargando…'}</p>
    </div>
  );
}
