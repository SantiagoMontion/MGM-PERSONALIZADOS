import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import styles from './Confirm.module.css';
import { diag, warn } from '@/lib/log';

export default function Confirm() {
  const [sp] = useSearchParams();
  const jobId = sp.get('job_id');
  const [data, setData] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [err, setErr] = useState('');
  const productUrl = typeof data?.shopify_product_url === 'string' && data.shopify_product_url.trim()
    ? data.shopify_product_url.trim()
    : null;

  useEffect(() => {
    let t;
    async function tick() {
      try {
        const res = await apiFetch(`/api/job-summary?id=${encodeURIComponent(jobId)}`);
        const json = await res.json();
        setData(json);
        if (!json.shopify_product_url || (json.status !== 'READY_FOR_PRODUCTION' && json.status !== 'SHOPIFY_CREATED')) {
          t = setTimeout(tick, 2000);
        }
      } catch (e) {
        setErr(String(e?.message || e));
        t = setTimeout(tick, 3000);
      }
    }
    if (jobId) tick();
    return () => clearTimeout(t);
  }, [jobId]);

  useEffect(() => {
    if (!autoOpened && productUrl) {
      try {
        const popup = window.open(productUrl, '_blank', 'noopener');
        if (popup && !popup.closed) {
          try {
            popup.opener = null;
          } catch (openerErr) {
            diag('[confirm] opener_clear_failed', openerErr);
          }
        }
      } catch (openErr) {
        warn('[confirm] product_open_failed', openErr);
      } finally {
        setAutoOpened(true);
      }
    }
  }, [autoOpened, productUrl]);

  if (!jobId) return <p>Falta job_id.</p>;

  return (
    <div>
      <h1>Tu diseño</h1>
      {data.preview_url && (
        <img src={data.preview_url} alt="preview" className={styles.previewImage} />
      )}
      <p>Material: <b>{data.material}</b> — Tamaño: <b>{data.w_cm}×{data.h_cm} cm</b></p>
      {data.price_amount ? <p>Precio: <b>${data.price_amount}</b></p> : null}

      <div className={styles.actions}>
        {productUrl && (
          <a className="btn" href={productUrl} target="_blank" rel="noopener noreferrer">
            Ver producto
          </a>
        )}
        {data.checkout_url && (
          <a className="btn" href={data.checkout_url} target="_blank" rel="noreferrer">Pagar ahora</a>
        )}
        <a className="btn" href="/">Cargar otro diseño</a>
      </div>

      {err && <p className="errorText">{err}</p>}
      {!productUrl && <p>Preparando la página del producto…</p>}
    </div>
  );
}