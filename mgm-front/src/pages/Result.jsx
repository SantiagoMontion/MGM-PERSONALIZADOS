import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { openCartUrl } from "@/lib/cart";

export default function Result() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [urls, setUrls] = useState({
    cart_url_follow: location.state?.cart_url_follow,
    checkout_url_now: location.state?.checkout_url_now,
    cart_plain: location.state?.cart_plain,
    checkout_plain: location.state?.checkout_plain,
  });
  const [job, setJob] = useState(null);
  const [added, setAdded] = useState(
    () => localStorage.getItem(`MGM_jobAdded:${jobId}`) === "true",
  );

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
    if (!urls.cart_url_follow || !urls.checkout_url_now) {
      async function ensureUrls() {
        try {
          const res = await apiFetch(`/api/create-cart-link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: jobId }),
          });
          const j = await res.json();
          if (res.ok) {
            setUrls({
              cart_url_follow: j.cart_url_follow || j.cart_url,
              checkout_url_now: j.checkout_url_now,
              cart_plain: j.cart_plain,
              checkout_plain: j.checkout_plain,
            });
          }
        } catch (error) {
          console.error("[result] ensure urls failed", error);
        }
      }
      ensureUrls();
    }
  }, [urls, jobId]);

  if (!urls.cart_url_follow || !urls.checkout_url_now) {
    return <p>Preparando tu carrito…</p>;
  }

  const hrefCart = added ? urls.cart_plain : urls.cart_url_follow;
  const hrefCheckout = added ? urls.checkout_plain : urls.checkout_url_now;
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
