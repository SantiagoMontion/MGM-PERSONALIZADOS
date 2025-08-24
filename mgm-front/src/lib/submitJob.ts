// src/lib/submitJob.ts
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
  notes?: string;
  source?: string;
}

export async function submitJob(apiBase: string, body: SubmitJobBody): Promise<any> {
  const base = (apiBase || 'https://mgm-api.vercel.app').replace(/\/$/, '');
  const res = await fetch(`${base}/api/submit-job`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': body.job_id,
    },
    body: JSON.stringify(body),
  });

  const diagId = res.headers.get('X-Diag-Id') || '(sin diag)';
  let data: any = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    console.error('[submit-job FAILED]', {
      status: res.status,
      diagId,
      stage: data?.stage,
      missing: data?.missing,
      hints: data?.hints,
      expect: data?.expect,
      payloadSent: body,
    });
    const hints = Array.isArray(data?.hints) ? data.hints.join(' | ') : '';
    throw new Error(`submit-job ${res.status} diag:${diagId} stage:${data?.stage || 'unknown'} ${hints}`);
  }

  console.log('[submit-job OK]', { diagId, job: data?.job });
  return data?.job;
}

// También default para que cualquier import antiguo siga funcionando
export default submitJob;
