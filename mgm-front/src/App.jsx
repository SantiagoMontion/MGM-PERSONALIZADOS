import { Link, Outlet } from 'react-router-dom';
import styles from './App.module.css';
import SeoJsonLd from './components/SeoJsonLd';
import Footer from './components/Footer';

export default function App() {
  return (
    <div className={styles.container}>
      <SeoJsonLd />
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          MGM GAMERS®
        </Link>
        <span>EDITOR</span>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
