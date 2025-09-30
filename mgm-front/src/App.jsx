import { Link, Outlet, useLocation } from 'react-router-dom';
import styles from './App.module.css';
import SeoJsonLd from './components/SeoJsonLd';
import Footer from './components/Footer';

export default function App() {
  const location = useLocation();
  const shouldShowFooter = location.pathname === '/mockup';

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
      {shouldShowFooter && <Footer />}
    </div>
  );
}
