import { submitJob } from './submitJob';
import { dlog } from './debug';

export interface JobStatus {
  job_id: string;
  status?: string;
  price_amount?: number | null;
  price_currency?: string | null;
  print_jpg_url?: string | null;
  pdf_url?: string | null;
  preview_url?: string | null;
}

async function sleep(ms:number){ return new Promise(r=>setTimeout(r, ms)); }

export async function finalizeAssetsOrPoll(apiBase:string, jobId:string, opts?:{ render?:any; render_v2?:any; maxAttempts?:number; intervalMs?:number; onTick?:(attempt:number, job?:JobStatus)=>void; }){
  const base = (apiBase || '').replace(/\/$/, '');
  const body = opts?.render_v2 ? { job_id: jobId, render_v2: opts.render_v2 } :
               opts?.render ? { job_id: jobId, render: opts.render } :
               { job_id: jobId };
  try {
    const resp = await fetch(`${base}/api/finalize-assets`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    dlog('finalize diag', resp.headers.get('X-Diag-Id'));
  } catch(e) {
    console.warn('[finalize-assets warn]', e);
  }

  const maxAttempts = opts?.maxAttempts ?? 45;
  const intervalMs = opts?.intervalMs ?? 2000;
  let last: JobStatus | undefined;
  for (let i=1;i<=maxAttempts;i++) {
    try {
      const res = await fetch(`${base}/api/job-status?job_id=${encodeURIComponent(jobId)}`);
      if (res.ok) {
        const j = await res.json();
        if (j?.ok) {
          last = j.job as JobStatus;
          opts?.onTick?.(i, last);
          if (last.print_jpg_url && last.pdf_url && last.preview_url && last.price_amount) break;
        }
      }
    } catch(err) {
      console.warn('[job-status warn]', err);
    }
    await sleep(intervalMs);
  }
  return last;
}

export async function createCartLink(apiBase:string, jobId:string){
  const base = (apiBase || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/create-cart-link`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ job_id: jobId })
  });
  const j = await res.json();
  if (!res.ok) {
    const code = j?.error || 'unknown';
    const diag = res.headers.get('X-Diag-Id') || '';
    throw new Error(`create-cart-link ${code} diag:${diag}`);
  }
  return j;
}

export async function orchestrateJob(apiBase:string, submitBody:any, finalizeOpts?:{ render?:any; render_v2?:any; onTick?:(stage:string)=>void; }){
  const job = await submitJob(apiBase, submitBody);
  const jobId = job?.job_id || submitBody.job_id;
  finalizeOpts?.onTick?.('finalize');
  const finalJob = await finalizeAssetsOrPoll(apiBase, jobId, { render: finalizeOpts?.render, render_v2: finalizeOpts?.render_v2 });
  finalizeOpts?.onTick?.('cart');
  const cart = await createCartLink(apiBase, jobId);
  return { job_id: jobId, preview_url: finalJob?.preview_url, ...cart };
}

export default orchestrateJob;

