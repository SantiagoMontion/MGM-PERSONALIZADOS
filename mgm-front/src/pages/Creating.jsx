import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import LoadingOverlay from '../components/LoadingOverlay';
import { pollJobAndCreateCart } from '../lib/pollJobAndCreateCart';

export default function Creating() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const render = location.state?.render;
  const apiBase = import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app';

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        await fetch(`${apiBase}/api/finalize-assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(render ? { job_id: jobId, render } : { job_id: jobId })
        }).catch(() => {});

        const res = await pollJobAndCreateCart(apiBase, jobId);
        if (!cancelled) {
          navigate(`/result/${jobId}`, {
            state: {
              cart_url_follow: res?.raw?.cart_url_follow || res?.raw?.cart_url,
              checkout_url_now: res?.raw?.checkout_url_now
            }
          });
        }
      } catch {
        if (!cancelled) navigate(`/result/${jobId}`);
      }
    }
    if (jobId) run();
    return () => { cancelled = true; };
  }, [apiBase, jobId, render, navigate]);

  return (
    <div>
      <LoadingOverlay show messages={["Creando tu pedido…"]} />
      <button onClick={() => navigate('/')}>Cancelar</button>
    </div>
  );
}
