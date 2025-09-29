import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import LoadingOverlay from '../components/LoadingOverlay';
import { apiFetch } from '@/lib/api';

export default function Creating() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const render = location.state?.render;
  const render_v2 = location.state?.render_v2;
  const skipFinalize = location.state?.skipFinalize;
  const [needsRetry, setNeedsRetry] = useState(false);
  const [productUrl, setProductUrl] = useState('');
  const [autoOpened, setAutoOpened] = useState(false);

  const run = useCallback(async () => {
    setNeedsRetry(false);
    try {
      const mode = render_v2?.material || render?.material || 'Classic';
      const isGlasspad = mode === 'Glasspad';
      const payload = {
        job_id: jobId,
        mode,
        width_cm: isGlasspad ? 49 : Number(render_v2?.w_cm ?? render?.w_cm ?? 0),
        height_cm: isGlasspad ? 42 : Number(render_v2?.h_cm ?? render?.h_cm ?? 0),
        design_url: render_v2?.design_url ?? render?.design_url ?? null,
        bleed_mm: Number(render_v2?.bleed_mm ?? render?.bleed_mm ?? 0),
        rotate_deg: Number(render_v2?.rotate_deg ?? render?.rotate_deg ?? 0),
        ...(isGlasspad ? { glasspad: { effect: true } } : {}),
      };
      await apiFetch(`/api/finalize-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      try {
        const summaryRes = await apiFetch(`/api/job-summary?id=${encodeURIComponent(jobId)}`);
        if (summaryRes.ok) {
          const summaryJson = await summaryRes.json().catch(() => null);
          const url = typeof summaryJson?.shopify_product_url === 'string'
            ? summaryJson.shopify_product_url.trim()
            : '';
          if (url) {
            setProductUrl(url);
          }
        }
      } catch (summaryErr) {
        console.warn('[creating] job_summary_failed', summaryErr);
      }
    } catch {
      setNeedsRetry(true);
    }
  }, [jobId, render, render_v2]);

  useEffect(() => {
    if (jobId && !skipFinalize) run();
  }, [jobId, run, skipFinalize]);

  useEffect(() => {
    if (!productUrl || autoOpened) return;
    try {
      const popup = window.open(productUrl, '_blank', 'noopener');
      if (popup && !popup.closed) {
        try {
          popup.opener = null;
        } catch (openerErr) {
          console.debug?.('[creating] opener_clear_failed', openerErr);
        }
      }
    } catch (openErr) {
      console.warn('[creating] product_open_failed', openErr);
    } finally {
      setAutoOpened(true);
    }
  }, [autoOpened, productUrl]);

  return (
    <div>
      <LoadingOverlay
        show={!needsRetry && !skipFinalize && !productUrl}
        messages={['Creando tu pedido…']}
      />
      {skipFinalize && (
        <p>Modo sólo previsualización: finalize-assets no fue llamado.</p>
      )}
      {productUrl && (
        <p>
          Abrimos la página pública del producto. También podés{' '}
          <a href={productUrl} target="_blank" rel="noopener noreferrer">
            abrirla manualmente
          </a>
          .
        </p>
      )}
      {needsRetry && (
        <button
          onClick={() => {
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
