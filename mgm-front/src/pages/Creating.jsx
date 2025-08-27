import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import LoadingOverlay from '../components/LoadingOverlay';
import { pollJobAndCreateCart } from '../lib/pollJobAndCreateCart';

export default function Creating() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const render = location.state?.render;
  const render_v2 = location.state?.render_v2;
  const skipFinalize = location.state?.skipFinalize;
  const apiBase = import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app';

  const [needsRetry, setNeedsRetry] = useState(false);

  const run = useCallback(async () => {
    setNeedsRetry(false);
    try {
      const resp = await fetch(`${apiBase}/api/finalize-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          render_v2
            ? { job_id: jobId, render_v2 }
            : render
            ? { job_id: jobId, render }
            : { job_id: jobId }
        )
      });
      console.log('finalize diag', resp.headers.get('X-Diag-Id'));

      let retried = false;
      const res = await pollJobAndCreateCart(apiBase, jobId, {
        onTick: async (attempt, job) => {
          if (!retried && attempt >= 10 && job?.status === 'CREATED') {
            retried = true;
            try {
              const r = await fetch(`${apiBase}/api/finalize-assets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: jobId })
              });
              console.log('retry finalize diag', r.headers.get('X-Diag-Id'));
            } catch (e) {
              console.warn(e);
            }
          }
        }
      });

      if (res.ok) {
        navigate(`/result/${jobId}`, {
          state: {
            cart_url_follow: res?.raw?.cart_url_follow || res?.raw?.cart_url,
            checkout_url_now: res?.raw?.checkout_url_now
          }
        });
      } else {
        setNeedsRetry(true);
      }
    } catch {
      setNeedsRetry(true);
    }
  }, [apiBase, jobId, render, render_v2, navigate]);

  useEffect(() => {
    if (jobId && !skipFinalize) run();
  }, [jobId, run, skipFinalize]);

  return (
    <div>
      <LoadingOverlay show={!needsRetry && !skipFinalize} messages={["Creando tu pedido…"]} />
      {skipFinalize && <p>Modo sólo previsualización: finalize-assets no fue llamado.</p>}
      {needsRetry && (
        <button
          onClick={() => {
            console.log('manual retry');
            run();
          }}
        >
          Reintentar
        </button>
      )}
      <button onClick={() => navigate('/')}>Cancelar</button>
    </div>
  );
}

