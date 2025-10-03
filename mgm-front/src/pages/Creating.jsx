import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import LoadingOverlay from '../components/LoadingOverlay';
import { apiFetch } from '@/lib/api';
import logger from '../lib/logger';

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
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setNeedsRetry(false);
    setLoading(true);
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
      const finalizeRes = await apiFetch(`/api/finalize-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const finalizeText = await finalizeRes.text();
      let finalizeJson = null;
      try {
        finalizeJson = finalizeText ? JSON.parse(finalizeText) : null;
      } catch {
        finalizeJson = null;
      }
      if (!finalizeRes.ok) {
        const message = typeof finalizeJson?.error === 'string' && finalizeJson.error
          ? finalizeJson.error
          : finalizeText;
        const error = new Error(`HTTP ${finalizeRes.status}${message ? ` ${message}` : ''}`.trim());
        error.status = finalizeRes.status;
        error.bodyText = finalizeText;
        error.json = finalizeJson;
        throw error;
      }

      try {
        const summaryRes = await apiFetch(`/api/job-summary?id=${encodeURIComponent(jobId)}`);
        const summaryText = await summaryRes.text();
        let summaryJson = null;
        try {
          summaryJson = summaryText ? JSON.parse(summaryText) : null;
        } catch {
          summaryJson = null;
        }
        if (summaryRes.ok) {
          const url = typeof summaryJson?.shopify_product_url === 'string'
            ? summaryJson.shopify_product_url.trim()
            : '';
          if (url) {
            setProductUrl(url);
          }
        } else {
          const summaryMessage = typeof summaryJson?.error === 'string' && summaryJson.error
            ? summaryJson.error
            : summaryText;
          logger.warn('[creating] job_summary_failed', {
            status: summaryRes.status,
            bodyText: summaryText,
            message: summaryMessage,
          });
        }
      } catch (summaryErr) {
        logger.warn('[creating] job_summary_failed', {
          message: summaryErr?.message || summaryErr,
          status: summaryErr?.status,
          bodyText: summaryErr?.bodyText,
        });
      }
    } catch (err) {
      logger.error('[creating] finalize_failed', {
        message: err?.message || err,
        status: err?.status,
        bodyText: err?.bodyText,
      });
      setNeedsRetry(true);
    } finally {
      setLoading(false);
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
          logger.debug('[creating] opener_clear_failed', openerErr);
        }
      }
    } catch (openErr) {
      logger.warn('[creating] product_open_failed', openErr);
    } finally {
      setAutoOpened(true);
    }
  }, [autoOpened, productUrl]);

  const showOverlay = !skipFinalize && (loading || (!needsRetry && !productUrl));

  return (
    <div>
      <LoadingOverlay
        show={showOverlay}
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