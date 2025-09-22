import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import SeoJsonLd from '../components/SeoJsonLd';
import styles from './NotFound.module.css';

const LOST_META = {
  title: '¿Estás perdido? — MGMGAMERS',
  description: 'No encontramos la página que buscabas. Volvé al inicio o contactá a nuestro equipo para obtener ayuda.',
  canonical: 'https://www.mgmgamers.store/404'
};

const ERROR_META = {
  title: 'Algo salió mal — MGMGAMERS',
  description: 'Tuvimos un inconveniente inesperado al cargar la página. Probá nuevamente o escribinos si el problema persiste.',
  canonical: 'https://www.mgmgamers.store/error'
};

function LostLayout({
  eyebrow = 'Error 404',
  title = '¿Estás perdido?',
  description = 'No encontramos la página que buscabas. Volvé al inicio o contactá a nuestro equipo para obtener ayuda.',
  details = null,
  meta = LOST_META
}) {
  return (
    <>
      <SeoJsonLd
        title={meta.title}
        description={meta.description}
        canonical={meta.canonical}
        noIndex
      />
      <section className={styles.container}>
        <span className={styles.illustration} role="img" aria-hidden="true">
          🧭
        </span>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
        {details && <p className={styles.details}>{details}</p>}
        <div className={styles.actions}>
          <Link className={styles.primary} to="/">
            Ir al inicio
          </Link>
          <Link className={styles.secondary} to="/contacto">
            Hablar con soporte
          </Link>
        </div>
      </section>
    </>
  );
}

export default function NotFound() {
  return <LostLayout />;
}

export function NotFoundBoundary() {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);
  if (isResponse && error.status === 404) {
    const detailMessage = typeof error.data === 'string' ? error.data : null;
    return <LostLayout details={detailMessage} />;
  }

  const fallbackDetails = (() => {
    if (!error) return null;
    if (isResponse) {
      const parts = [error.statusText, typeof error.data === 'string' ? error.data : null].filter(Boolean);
      return parts.length ? parts.join(' — ') : null;
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return null;
  })();

  const eyebrow = isResponse && error?.status ? `Error ${error.status}` : 'Error inesperado';
  return (
    <LostLayout
      eyebrow={eyebrow}
      title="Algo salió mal"
      description="Tuvimos un inconveniente inesperado al cargar la página. Probá nuevamente o escribinos si el problema persiste."
      details={fallbackDetails}
      meta={ERROR_META}
    />
  );
}
