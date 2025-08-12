import { Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div style={{maxWidth: 960, margin: '0 auto', padding: 16}}>
      <Outlet />
    </div>
  );
}
