import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { openCartUrl } from "@/lib/cart";

export default function Result() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [urls, setUrls] = useState({
    cartUrl: location.state?.cartUrl,
    checkoutUrl: location.state?.checkoutUrl,
    cartPlain: location.state?.cartPlain,
    checkoutPlain: location.state?.checkoutPlain,
    strategy: location.state?.strategy,
  });
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

  useEffect(() => {
    if (!urls.cartUrl || !urls.checkoutUrl) {
      async function ensureUrls() {
        try {
          const res = await apiFetch(`/api/cart/link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: jobId }),
          });
          const j = await res.json();
          const cartUrl =
            typeof j?.webUrl === "string"
              ? j.webUrl
              : typeof j?.url === "string"
                ? j.url
                : null;
          if (res.ok && cartUrl) {
            setUrls({
              cartUrl,
              checkoutUrl: j.checkoutUrl,
              cartPlain: j.cartPlain,
              checkoutPlain: j.checkoutPlain,
              strategy: j.strategy,
            });
          }
        } catch (error) {
          console.error("[result] ensure urls failed", error);
        }
      }
      ensureUrls();
    }
  }, [urls, jobId]);

  useEffect(() => {
    if (!autoOpened && !added && urls.cartUrl) {
      const opened = openCartUrl(urls.cartUrl);
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
  }, [added, autoOpened, jobId, urls.cartUrl]);

  if (!urls.cartUrl) {
    return <p>Preparando tu carrito…</p>;
  }

  const hrefCart = added && urls.cartPlain ? urls.cartPlain : urls.cartUrl;
  const checkoutCandidate = added && urls.checkoutPlain ? urls.checkoutPlain : urls.checkoutUrl;
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
