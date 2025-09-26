export interface JobStatus {
  job_id: string;
  status?: string;
  price_amount?: number | null;
  price_currency?: string | null;
  print_jpg_url?: string | null;
  pdf_url?: string | null;
  preview_url?: string | null;
  material?: string | null;
  w_cm?: number | null;
  h_cm?: number | null;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

import { apiFetch } from "./api";

export async function pollJobAndCreateCart(
  jobId: string,
  opts?: {
    maxAttempts?: number;
    intervalMs?: number;
    onTick?: (attempt: number, job?: JobStatus) => void;
  },
) {
  const maxAttempts = opts?.maxAttempts ?? 45; // ~90s si interval=2000
  const intervalMs = opts?.intervalMs ?? 2000;

  // función para consultar estado
  async function fetchStatus(): Promise<JobStatus | undefined> {
    const res = await apiFetch(
      `/api/job-status?job_id=${encodeURIComponent(jobId)}`,
      { method: "GET" },
    );
    if (!res.ok) throw new Error(`job-status ${res.status}`);
    const j = await res.json();
    if (!j?.ok) return undefined;
    return j.job as JobStatus;
  }

  // criterio de readiness (assets + price)
  function isReady(job?: JobStatus) {
    if (!job) return false;
    if (!job.print_jpg_url || !job.pdf_url) return false;
    if (!job.price_amount || job.price_amount <= 0) return false;
    return true;
  }

  // loop de polling
  let last: JobStatus | undefined;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      last = await fetchStatus();
      opts?.onTick?.(i, last);
      if (isReady(last)) break;
    } catch (e) {
      console.error("[poll job-status warn]", e);
    }
    await sleep(intervalMs);
  }

    // Si no está listo, intentar igual cart/link (puede preparar producto/variante)
    const createCart = async () => {
      const res = await apiFetch(`/api/cart/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });
      const j = await res.json();
      if (!res.ok || typeof j?.webUrl !== "string") {
        // Si falta algo, seguir esperando si hay intentos restantes
        const code = j?.reason || j?.error || "unknown";
        return { ok: false, code, detail: j?.detail, raw: j };
      }
      return { ok: true, cart_url: j.webUrl, raw: j };
    };

  // primer intento crear carrito
  let attempt = await createCart();
  if (attempt.ok) return attempt;

  // si falló por assets_not_ready o invalid_price, seguimos poll
  const retriable = new Set([
    "assets_not_ready",
    "invalid_price",
    "job_not_found",
    "job_variant_missing",
    "missing_variant",
  ]);
  for (let i = 1; i <= maxAttempts; i++) {
    if (!retriable.has(String(attempt.code))) break;
    await sleep(intervalMs);
    try {
      last = await fetchStatus();
      opts?.onTick?.(maxAttempts + i, last);
    } catch (err) {}
    attempt = await createCart();
    if (attempt.ok) break;
  }
  return attempt;
}
