import { Outlet } from 'react-router-dom';
import styles from './App.module.css';

export default function App() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <strong>MGM GAMERS®</strong>
        <span>EDITOR</span>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <a href="/legal/terminos">Términos</a> ·{' '}
        <a href="/legal/privacidad">Privacidad</a> ·{' '}
        <a href="/legal/contenido">Contenido</a> ·{' '}
        <a href="/legal/devoluciones">Devoluciones</a> ·{' '}
        <a href="/legal/dmca">DMCA</a>
      </footer>
    </div>
  );
}
