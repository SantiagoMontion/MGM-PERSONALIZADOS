import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

export default function Result() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const apiBase = import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app';

  const [urls, setUrls] = useState({
    cart_url_follow: location.state?.cart_url_follow,
    checkout_url_now: location.state?.checkout_url_now,
  });
  const [job, setJob] = useState(null);

  useEffect(() => {
    async function fetchJob() {
      try {
        const res = await fetch(`${apiBase}/api/job-status?job_id=${encodeURIComponent(jobId)}`);
        const j = await res.json();
        if (res.ok && j.ok) setJob(j.job);
      } catch { /* ignore */ }
    }
    fetchJob();
  }, [apiBase, jobId]);

  useEffect(() => {
    if (!urls.cart_url_follow || !urls.checkout_url_now) {
      async function ensureUrls() {
        try {
          const res = await fetch(`${apiBase}/api/create-cart-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId }),
          });
          const j = await res.json();
          if (res.ok) {
            setUrls({
              cart_url_follow: j.cart_url_follow || j.cart_url,
              checkout_url_now: j.checkout_url_now,
            });
          }
        } catch { /* ignore */ }
      }
      ensureUrls();
    }
  }, [urls, apiBase, jobId]);

  if (!urls.cart_url_follow || !urls.checkout_url_now) {
    return <p>Preparando tu carrito…</p>;
  }

  return (
    <div>
      {job?.preview_url && (
        <img src={job.preview_url} alt="preview" style={{ maxWidth: '300px' }} />
      )}
      <div>
        <button onClick={() => { window.location.href = urls.cart_url_follow; }}>
          Agregar al carrito y seguir comprando
        </button>
        <button onClick={() => { window.location.href = urls.checkout_url_now; }}>
          Pagar ahora
        </button>
        <button onClick={() => { window.open(urls.cart_url_follow, '_blank', 'noopener'); navigate('/'); }}>
          Crear otro
        </button>
      </div>
    </div>
  );
}
