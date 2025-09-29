import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import LoadingOverlay from "../components/LoadingOverlay";
import { pollJobAndCreateCart } from "../lib/pollJobAndCreateCart";
import { apiFetch } from "@/lib/api";

export default function Creating() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const render = location.state?.render;
  const render_v2 = location.state?.render_v2;
  const skipFinalize = location.state?.skipFinalize;
  const [needsRetry, setNeedsRetry] = useState(false);

  const run = useCallback(async () => {
    setNeedsRetry(false);
    try {
      const mode = render_v2?.material || render?.material || "Classic";
      const isGlasspad = mode === "Glasspad";
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let retried = false;
      const res = await pollJobAndCreateCart(jobId, {
        onTick: async (attempt, job) => {
          if (!retried && attempt >= 10 && job?.status === "CREATED") {
            retried = true;
            try {
              await apiFetch(`/api/finalize-assets`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
            } catch (e) {
              console.error("retry finalize failed", e);
            }
          }
        },
      });

      if (res.ok) {
        const cartUrlCandidate =
          (typeof res?.raw?.cartUrl === "string" && res.raw.cartUrl.trim())
            || (typeof res?.raw?.cartPlain === "string" && res.raw.cartPlain.trim())
            || (typeof res?.raw?.url === "string" && res.raw.url.trim())
            || (typeof res?.raw?.checkoutUrl === "string" && res.raw.checkoutUrl.trim())
            || null;
        const cartPlainCandidate =
          (typeof res?.raw?.cartPlain === "string" && res.raw.cartPlain.trim())
            || cartUrlCandidate
            || null;
        navigate(`/result/${jobId}`, {
          state: {
            cartUrl: cartUrlCandidate || undefined,
            checkoutUrl: res?.raw?.checkoutUrl || null,
            cartPlain: cartPlainCandidate || undefined,
            checkoutPlain: res?.raw?.checkoutPlain || null,
            strategy: res?.raw?.strategy,
          },
        });
      } else {
        setNeedsRetry(true);
      }
    } catch {
      setNeedsRetry(true);
    }
  }, [jobId, render, render_v2, navigate]);

  useEffect(() => {
    if (jobId && !skipFinalize) run();
  }, [jobId, run, skipFinalize]);

  return (
    <div>
      <LoadingOverlay
        show={!needsRetry && !skipFinalize}
        messages={["Creando tu pedido…"]}
      />
      {skipFinalize && (
        <p>Modo sólo previsualización: finalize-assets no fue llamado.</p>
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
      <button onClick={() => navigate("/")}>Cancelar</button>
    </div>
  );
}
