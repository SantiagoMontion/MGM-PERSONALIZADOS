import { canonicalizeSupabaseUploadsUrl } from './supabaseUrl';

type FitMode = 'cover'|'contain'|'stretch';

export function normalizeSubmitPayload(p: any) {
  const fit: FitMode = (p.fit_mode === 'contain' || p.fit_mode === 'stretch') ? p.fit_mode : 'cover';
  const dpi = parseInt(String(p.dpi), 10);

  return {
    job_id: String(p.job_id),
    material: String(p.material),
    w_cm: Number(p.w_cm),
    h_cm: Number(p.h_cm),
    bleed_mm: Number(p.bleed_mm),
    fit_mode: fit,
    bg: String(p.bg || '#ffffff'),
    dpi: Number.isFinite(dpi) ? dpi : 300,
    file_original_url: canonicalizeSupabaseUploadsUrl(String(p.file_original_url)),
    customer_email: p.customer_email || undefined,
    customer_name: p.customer_name || undefined,
    file_hash: p.file_hash || undefined,
    price_amount: (p.price_amount != null ? Number(p.price_amount) : undefined),
    price_currency: p.price_currency || undefined,
    notes: p.notes || undefined,
    source: p.source || 'front',
  };
}

export async function postSubmitJob(apiBase: string, payload: any) {
  const url = `${apiBase.replace(/\/$/, '')}/api/submit-job`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': payload.job_id ?? (crypto?.randomUUID?.() || String(Date.now()))
    },
    body: JSON.stringify(payload)
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
      raw: data
    });
    const hints = Array.isArray(data?.hints) ? data.hints.join(' | ') : '';
    throw new Error(`submit-job ${res.status} diag:${diagId} stage:${data?.stage || 'unknown'} ${hints}`);
  }

  console.log('[submit-job OK]', { diagId, job: data?.job });
  return data?.job;
}
