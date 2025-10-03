import { Link, Outlet, useLocation } from 'react-router-dom';
import styles from './App.module.css';
import SeoJsonLd from './components/SeoJsonLd';
import Footer from './components/Footer';
import MobileAdvisoryBanner from './components/MobileAdvisoryBanner';

export default function App() {
  const location = useLocation();
  const shouldShowFooter = location.pathname === '/mockup';

  return (
    <div className={styles.container}>
      <SeoJsonLd />
      <MobileAdvisoryBanner />
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          MGM GAMERSÂ®
        </Link>
        {location.pathname === '/' && <span>EDITOR</span>}
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      {shouldShowFooter && <Footer />}
    </div>
  );
}


