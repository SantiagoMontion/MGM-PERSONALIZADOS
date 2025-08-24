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
    </div>
  );
}
