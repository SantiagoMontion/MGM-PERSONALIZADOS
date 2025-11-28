import { useEffect, useMemo, useState } from 'react';
import styles from './MobileAdvisoryBanner.module.css';

const WIDTH_QUERY = '(max-width: 991px)';
const POINTER_QUERY = '(pointer: coarse)';

const rawFlag = import.meta.env.VITE_SHOW_MOBILE_ADVISORY;
const advisoryEnabled = (() => {
  if (rawFlag === undefined || rawFlag === null || rawFlag === '') {
    return false; // mobile advisory disabled by default
  }
  return !['false', '0', 'no', 'off'].includes(String(rawFlag).toLowerCase());
})();

const bannerEmoji = String.fromCodePoint(0x1f6a7);
const bannerTitle = `Vers\u00edon m\u00f3vil en camino ${bannerEmoji}`;

const defaultCopy =
  'Por ahora us\u00e1 la web desde una computadora para personalizar y comprar sin problemas.';

export default function MobileAdvisoryBanner() {
  const [isMobileContext, setIsMobileContext] = useState(false);
  const [isBodyExcluded, setIsBodyExcluded] = useState(false);

  useEffect(() => {
    if (!advisoryEnabled || typeof window === 'undefined') {
      return;
    }

    const widthQuery = window.matchMedia(WIDTH_QUERY);
    const pointerQuery = window.matchMedia(POINTER_QUERY);

    const updateState = () => {
      const matchesWidth = widthQuery.matches;
      const matchesPointer = pointerQuery.matches;
      setIsMobileContext(matchesWidth || matchesPointer);
      setIsBodyExcluded(Boolean(document?.body?.classList?.contains('no-advisory')));
    };

    updateState();

    widthQuery.addEventListener('change', updateState);
    pointerQuery.addEventListener('change', updateState);
    window.addEventListener('resize', updateState);

    return () => {
      widthQuery.removeEventListener('change', updateState);
      pointerQuery.removeEventListener('change', updateState);
      window.removeEventListener('resize', updateState);
    };
  }, []);

  const messageCopy = useMemo(() => {
    const override = import.meta.env.VITE_MOBILE_ADVISORY_COPY;
    return typeof override === 'string' && override.trim().length ? override.trim() : defaultCopy;
  }, []);

  if (!advisoryEnabled || !isMobileContext || isBodyExcluded) {
    return null;
  }

  return (
    <section className={styles.overlay} role="region" aria-live="polite">
      <div className={styles.card}>
        <h1 className={styles.title}>{bannerTitle}</h1>
        <p className={styles.message}>{messageCopy}</p>
      </div>
    </section>
  );
}
