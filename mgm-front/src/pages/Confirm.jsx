import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import { openCartUrl } from '@/lib/cart';
import styles from './Confirm.module.css';

export default function Confirm() {
  const [sp] = useSearchParams();
  const jobId = sp.get('job_id');
  const [data, setData] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [err, setErr] = useState('');
  const cartEntryUrl = (data?.cart_plain && data.cart_plain.trim()) || (data?.cart_url && data.cart_url.trim()) || null;

  useEffect(() => {
    let t;
    async function tick() {
        try {
          const res = await apiFetch(`/api/job-summary?id=${encodeURIComponent(jobId)}`);
          const json = await res.json();
          setData(json);
          if (!json.cart_url || (json.status !== 'READY_FOR_PRODUCTION' && json.status !== 'SHOPIFY_CREATED')) {
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
    if (!autoOpened && cartEntryUrl) {
      try {
        openCartUrl(cartEntryUrl);
      } finally {
        setAutoOpened(true);
      }
    }
  }, [autoOpened, cartEntryUrl]);

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
        {cartEntryUrl && (
          <button
            type="button"
            onClick={() => openCartUrl(cartEntryUrl)}
            onClick={() => openCartUrl(data.cart_url)}
          >
            Agregar al carrito
          </button>
        )}
        {data.shopify_product_url && (
          <a className="btn" href={data.shopify_product_url} target="_blank">Ver producto</a>
        )}
        {data.checkout_url && (
          <a className="btn" href={data.checkout_url} target="_blank" rel="noreferrer">Pagar ahora</a>
        )}
        <a className="btn" href="/">Cargar otro diseño</a>
      </div>

      {err && <p className="errorText">{err}</p>}
      {!cartEntryUrl && <p>Preparando tu carrito�</p>}
    </div>
  );
}
