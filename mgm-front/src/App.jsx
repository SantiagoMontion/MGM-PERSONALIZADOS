import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import styles from './App.module.css';
import SeoJsonLd from './components/SeoJsonLd';
import Footer from './components/Footer';
import MobileAdvisoryBanner from './components/MobileAdvisoryBanner';
import ProgressHeader from './components/ProgressHeader';

const APP_THEME_STORAGE_KEY = 'mgm-app-theme';

function resolveCurrentStep(pathname) {
  if (pathname === '/') return 1;
  if (pathname.startsWith('/mockup')) return 3;
  if (
    pathname.startsWith('/confirm')
    || pathname.startsWith('/creating')
    || pathname.startsWith('/result/')
    || pathname.startsWith('/bridge')
  ) {
    return 3;
  }
  return null;
}

function resolveDocumentTitle(pathname) {
  if (pathname === '/') return 'Mousepad Personalizado a Medida | Calidad Gamer y Profesional | NOTMID';
  if (pathname.startsWith('/mockup')) return 'Vista previa del mousepad | NOTMID';
  if (pathname.startsWith('/votaciones')) return 'Sorteo Express 24hs | NOTMID';
  if (pathname.startsWith('/resultados')) return 'Resultados de la votación | NOTMID';
  return '';
}

export default function App() {
  const location = useLocation();
  const shouldShowFooter = location.pathname === '/mockup';
  const shouldLockViewport = location.pathname === '/';
  const [headerStepOverride, setHeaderStepOverride] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return true;
    const storedTheme = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (storedTheme === 'light') return false;
    if (storedTheme === 'dark') return true;
    return true;
  });
  const routeStep = useMemo(
    () => resolveCurrentStep(location.pathname),
    [location.pathname],
  );
  const currentStep = headerStepOverride ?? routeStep;
  const showStepper = currentStep !== null;

  useEffect(() => {
    if (location.pathname !== '/' && headerStepOverride !== null) {
      setHeaderStepOverride(null);
    }
  }, [headerStepOverride, location.pathname]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const root = window.document.documentElement;
    const body = window.document.body;
    const nextTheme = isDarkMode ? 'dark' : 'light';

    root.classList.remove('dark', 'light');
    body.classList.remove('dark', 'light');
    root.classList.add(nextTheme);
    body.classList.add(nextTheme);
    root.style.colorScheme = nextTheme;
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, nextTheme);
  }, [isDarkMode]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const nextTitle = resolveDocumentTitle(location.pathname);
    if (nextTitle) {
      document.title = nextTitle;
    }
  }, [location.pathname]);

  const handleToggleTheme = useCallback(() => {
    setIsDarkMode((prev) => !prev);
  }, []);

  const showTiendaLink =
    location.pathname.startsWith('/votaciones')
    || location.pathname.startsWith('/resultados');

  return (
    <div className={`${styles.container} ${shouldLockViewport ? styles.containerLocked : ''}`.trim()}>
      <SeoJsonLd />
      <MobileAdvisoryBanner />
      <ProgressHeader
        currentStep={currentStep}
        isDarkMode={isDarkMode}
        onToggleTheme={handleToggleTheme}
        showStepper={showStepper}
        showTiendaLink={showTiendaLink}
      />
      <main className={`${styles.main} ${shouldLockViewport ? styles.mainLocked : ''}`.trim()}>
        <Outlet context={{ setHeaderStepOverride, isDarkMode, toggleTheme: handleToggleTheme }} />
      </main>
      {shouldShowFooter && <Footer />}
    </div>
  );
}
