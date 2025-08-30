import { dlog } from './debug';
import { setDiagContext } from './diagContext';

export interface SubmitJobBody {
  job_id: string;
  material: string;
  w_cm: number;
  h_cm: number;
  bleed_mm: number;
  fit_mode: 'cover' | 'contain' | 'stretch';
  bg: string;
  dpi: number;
  file_original_url: string;
  customer_email?: string;
  customer_name?: string;
  file_hash?: string;
  price_amount?: number;
  price_currency?: string;
  design_name?: string;
  notes?: string;
  source?: string;
}

export async function submitJob(apiBase: string, body: SubmitJobBody): Promise<any> {
  const base = (apiBase || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/submit-job`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': body.job_id,
    },
    body: JSON.stringify(body),
  });
  const diagId = res.headers.get('X-Diag-Id') || '';
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    setDiagContext({ diag_id: diagId, stage: 'submit', job_id: body.job_id });
    throw new Error(`submit ${res.status} diag:${diagId} stage:submit`);
  }
  setDiagContext({ diag_id: diagId, job_id: data?.job?.job_id || body.job_id });
  dlog('[submit-job OK]', { diagId, job: data?.job });
  return data?.job;
}

export interface JobStatus {
  job_id: string;
  status?: string;
  price_amount?: number | null;
  price_currency?: string | null;
  print_jpg_url?: string | null;
  pdf_url?: string | null;
  preview_url?: string | null;
}

export async function pollJobUntilReady(apiBase: string, jobId: string, opts?:{ intervalMs?:number; maxAttempts?:number; onTick?:(n:number)=>void; }): Promise<JobStatus> {
  const base = (apiBase || '').replace(/\/$/, '');
  const max = opts?.maxAttempts ?? 60;
  const intMs = opts?.intervalMs ?? 2000;
  let last: JobStatus | undefined;
  for (let i=0;i<max;i++) {
    try {
      const r = await fetch(`${base}/api/job-status?job_id=${encodeURIComponent(jobId)}`);
      if (r.ok) {
        const j = await r.json();
        if (j?.ok) {
          last = j.job as JobStatus;
          if (last.print_jpg_url && last.pdf_url && last.preview_url && last.price_amount) {
            return last;
          }
        }
      }
    } catch {}
    await new Promise(r=>setTimeout(r,intMs));
    opts?.onTick?.(i+1);
  }
  throw new Error(`poll_timeout diag:${last ? '' : ''} stage:finalize`);
}

export async function createCartLink(apiBase: string, jobId: string): Promise<any> {
  const base = (apiBase || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/create-cart-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId }),
  });
  const diagId = res.headers.get('X-Diag-Id') || '';
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    setDiagContext({ diag_id: diagId, stage: 'cart', job_id: jobId });
    throw new Error(`cart ${res.status} diag:${diagId} stage:cart`);
  }
  setDiagContext({ diag_id: diagId, job_id: jobId });
  dlog('[create-cart-link OK]', { diagId, cart: data });
  return data;
}
