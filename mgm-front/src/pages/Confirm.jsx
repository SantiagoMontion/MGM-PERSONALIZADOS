import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function Confirm() {
  const [sp] = useSearchParams();
  const jobId = sp.get('job_id');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let t;
    async function tick() {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/job-summary?id=${encodeURIComponent(jobId)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'fetch_failed');
        setData(json);
        // si falta cart_url o status no listo, repoll
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

  if (!jobId) return <p>Falta job_id.</p>;
  if (!data) return <p>Cargando…</p>;

  return (
    <div>
      <h1>Tu diseño</h1>
      {data.preview_url && (
        <img src={data.preview_url} alt="preview" style={{maxWidth:'100%', border:'1px solid #ddd'}} />
      )}
      <p>Material: <b>{data.material}</b> — Tamaño: <b>{data.w_cm}×{data.h_cm} cm</b></p>
      {data.price_amount ? <p>Precio: <b>${data.price_amount}</b></p> : null}

      <div style={{display:'flex', gap:12, marginTop:12}}>
        {data.cart_url && (
          <a className="btn" href={data.cart_url}>Ir al carrito</a>
        )}
        {data.shopify_product_url && (
          <a className="btn" href={data.shopify_product_url} target="_blank">Ver producto</a>
        )}
        {/* opcional: si mantenés invoice */}
        {data.checkout_url && (
          <a className="btn" href={data.checkout_url} target="_blank" rel="noreferrer">Pagar ahora</a>
        )}
      </div>

      {err && <p style={{color:'crimson'}}>{err}</p>}
      {!data.cart_url && <p>Preparando tu carrito…</p>}
    </div>
  );
}
