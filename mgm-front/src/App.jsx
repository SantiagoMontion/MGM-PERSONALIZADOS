import { Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header
        style={{
          background: '#000',
          color: '#fff',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong>MGM GAMERS®</strong>
        <span>EDITOR</span>
      </header>
      <main style={{ flex: 1, padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
