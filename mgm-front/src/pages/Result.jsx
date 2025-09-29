import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { openCartUrl } from "@/lib/cart";

export default function Result() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [urls, setUrls] = useState(() => ({
    cartUrl:
      typeof location.state?.cartUrl === 'string'
        ? location.state.cartUrl.trim() || null
        : null,
    checkoutUrl:
      typeof location.state?.checkoutUrl === 'string'
        ? location.state.checkoutUrl.trim() || null
        : null,
    cartPlain:
      typeof location.state?.cartPlain === 'string'
        ? location.state.cartPlain.trim() || null
        : null,
    checkoutPlain:
      typeof location.state?.checkoutPlain === 'string'
        ? location.state.checkoutPlain.trim() || null
        : null,
    strategy: location.state?.strategy || null,
  }));
  const [job, setJob] = useState(null);
  const [added, setAdded] = useState(
    () => localStorage.getItem(`MGM_jobAdded:${jobId}`) === "true",
  );
  const [autoOpened, setAutoOpened] = useState(false);

  useEffect(() => {
    async function fetchJob() {
      try {
        const res = await apiFetch(
          `/api/job-status?job_id=${encodeURIComponent(jobId)}`,
        );
        const j = await res.json();
        if (res.ok && j.ok) setJob(j.job);
      } catch (error) {
        console.error("[result] job status failed", error);
      }
    }
    fetchJob();
  }, [jobId]);

  const normalizedCartUrl =
    typeof urls.cartUrl === 'string' ? urls.cartUrl.trim() : '';
  const normalizedCartPlain =
    typeof urls.cartPlain === 'string' ? urls.cartPlain.trim() : '';

  useEffect(() => {
    if (!jobId) return undefined;
    if (normalizedCartUrl || normalizedCartPlain) {
      return undefined;
    }

    let cancelled = false;
    const normalize = (value) =>
      typeof value === 'string' && value.trim() ? value.trim() : null;

    async function ensureUrls() {
      try {
        const res = await apiFetch(`/api/cart/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId }),
        });
        const j = await res.json();
        const cartUrl =
          normalize(j?.cartUrl)
            || normalize(j?.cartPlain)
            || normalize(j?.url)
            || normalize(j?.checkoutUrl);

        if (res.ok && cartUrl && !cancelled) {
          setUrls({
            cartUrl,
            cartPlain: normalize(j?.cartPlain) || cartUrl,
            checkoutUrl: normalize(j?.checkoutUrl),
            checkoutPlain: normalize(j?.checkoutPlain),
            strategy: j?.strategy || null,
          });
        }
      } catch (error) {
        console.error('[result] ensure urls failed', error);
      }
    }

    ensureUrls();
    return () => {
      cancelled = true;
    };
  }, [jobId, normalizedCartUrl, normalizedCartPlain]);

  const cartEntryUrl = normalizedCartUrl || normalizedCartPlain || null;
  useEffect(() => {
    if (!autoOpened && !added && cartEntryUrl) {
      const opened = openCartUrl(cartEntryUrl);
      setAutoOpened(true);
      if (opened) {
        try {
          localStorage.setItem(`MGM_jobAdded:${jobId}`, "true");
        } catch (err) {
          console.warn("[result] persist added flag failed", err);
        }
        setAdded(true);
      }
    }
  }, [added, autoOpened, cartEntryUrl, jobId]);

  if (!cartEntryUrl) {
    const fallbackCartUrl =
      normalizedCartUrl || normalizedCartPlain || null;

    return (
      <div>
        <p>Estamos preparando tu carrito…</p>
        {fallbackCartUrl && (
          <button
            onClick={() => {
              openCartUrl(fallbackCartUrl);
              localStorage.setItem(`MGM_jobAdded:${jobId}`, "true");
              setAdded(true);
            }}
          >
            Intentar abrir el carrito
          </button>
        )}
        <button onClick={() => navigate("/")}>Volver al inicio</button>
      </div>
    );
  }

  const hrefCart =
    added && typeof urls.cartPlain === 'string' && urls.cartPlain.trim()
      ? urls.cartPlain.trim()
      : cartEntryUrl;
  const checkoutCandidate =
    (added && typeof urls.checkoutPlain === 'string' && urls.checkoutPlain.trim()
      ? urls.checkoutPlain.trim()
      : null)
      || (typeof urls.checkoutUrl === 'string' && urls.checkoutUrl.trim()
        ? urls.checkoutUrl.trim()
        : null);
  const hrefCheckout = checkoutCandidate || hrefCart;
  const openNew = (u) => window.open(u, "_blank", "noopener");

  return (
    <div>
      {job?.preview_url && (
        <img
          src={job.preview_url}
          alt="preview"
          style={{ maxWidth: "300px" }}
        />
      )}
      <div>
        <button
          onClick={() => {
            openCartUrl(hrefCart);
            localStorage.setItem(`MGM_jobAdded:${jobId}`, "true");
            setAdded(true);
          }}
        >
          Agregar al carrito y seguir comprando
        </button>
        <button
          onClick={() => {
            openNew(hrefCheckout);
            localStorage.setItem(`MGM_jobAdded:${jobId}`, "true");
            setAdded(true);
          }}
        >
          Pagar ahora
        </button>
        <button
          onClick={() => {
            openCartUrl(hrefCart);
            localStorage.setItem(`MGM_jobAdded:${jobId}`, "true");
            setAdded(true);
            navigate("/");
          }}
        >
          Crear otro
        </button>
      </div>
    </div>
  );
}
