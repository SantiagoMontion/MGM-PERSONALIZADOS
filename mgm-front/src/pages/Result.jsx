import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import logger from '../lib/logger';

export default function Result() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [productUrl, setProductUrl] = useState('');
  const [autoOpened, setAutoOpened] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function fetchSummary() {
      try {
        const res = await apiFetch(`/api/job-summary?id=${encodeURIComponent(jobId)}`);
        if (!res.ok) {
          const message = `job-summary ${res.status}`;
          setError(message);
          return;
        }
        const json = await res.json().catch(() => null);
        if (!json || typeof json !== 'object') {
          setError('No pudimos obtener los datos del producto.');
          return;
        }
        const url = typeof json.shopify_product_url === 'string' ? json.shopify_product_url.trim() : '';
        if (!cancelled) {
          if (url) {
            setProductUrl(url);
          } else {
            setError('El producto todavía no está listo en la tienda.');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err?.message || err));
        }
      }
    }

    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!productUrl || autoOpened) return;
    try {
      const popup = window.open(productUrl, '_blank', 'noopener');
      if (popup && !popup.closed) {
        try {
          popup.opener = null;
        } catch (openerErr) {
          logger.debug('[result] opener_clear_failed', openerErr);
        }
      }
    } catch (openErr) {
      logger.warn('[result] product_open_failed', openErr);
    } finally {
      setAutoOpened(true);
    }
  }, [autoOpened, productUrl]);

  if (!jobId) {
    return (
      <div>
        <p>Falta el identificador del trabajo.</p>
        <button type="button" onClick={() => navigate('/')}>Volver al inicio</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Producto creado</h1>
      {productUrl ? (
        <p>
          Abrimos la página del producto en otra pestaña. También podés
          {' '}
          <a href={productUrl} target="_blank" rel="noopener noreferrer">
            abrirla manualmente
          </a>
          .
        </p>
      ) : (
        <p>Estamos preparando la página pública del producto…</p>
      )}
      {error && <p className="errorText">{error}</p>}
      {productUrl && (
        <button
          type="button"
          onClick={() => window.open(productUrl, '_blank', 'noopener')}
        >
          Abrir página del producto
        </button>
      )}
      <button type="button" onClick={() => navigate('/')}>Crear otro diseño</button>
    </div>
  );
}