import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import styles from './Confirm.module.css';

export default function Confirm() {
  const [sp] = useSearchParams();
  const jobId = sp.get('job_id');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let t;
    async function tick() {
      try {
        const json = await api(`/api/job-summary?id=${encodeURIComponent(jobId)}`);
        setData(json);
        if (!json.cart_url || (json.status !== 'READY_FOR_PRODUCTION' && json.status !== 'SHOPIFY_CREATED')) {
          t = setTimeout(tick, 2000);
        }
      } catch (e) {
        setErr(String(e?.body?.error || e?.message || e));
        t = setTimeout(tick, 3000);
      }
    }
    if (jobId) tick();
    return () => clearTimeout(t);
  }, [jobId]);

  if (!jobId) return <p>Falta job_id.</p>;
  if (!data) return <p>Cargando…</p>;

  return (
    <div>
      <h1>Tu diseño</h1>
      {data.preview_url && (
        <img src={data.preview_url} alt="preview" className={styles.previewImage} />
      )}
      <p>Material: <b>{data.material}</b> — Tamaño: <b>{data.w_cm}×{data.h_cm} cm</b></p>
      {data.price_amount ? <p>Precio: <b>${data.price_amount}</b></p> : null}

      <div className={styles.actions}>
        {data.cart_url && (
          <a className="btn" href={data.cart_url} target="_blank" rel="noopener">Agregar al carrito</a>
        )}
        {data.shopify_product_url && (
          <a className="btn" href={data.shopify_product_url} target="_blank" rel="noopener">Ver producto</a>
        )}
        {data.checkout_url && (
          <a className="btn" href={data.checkout_url} target="_blank" rel="noopener">Pagar ahora</a>
        )}
        <a className="btn" href="/">Cargar otro diseño</a>
      </div>

      {err && <p className="errorText">{err}</p>}
      {!data.cart_url && <p>Preparando tu carrito…</p>}
    </div>
  );
}
