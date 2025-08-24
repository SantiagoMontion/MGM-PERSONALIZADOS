// src/lib/submitJob.js
export async function submitJob(apiBase, body) {
  const base = (apiBase || 'https://mgm-api.vercel.app').replace(/\/$/, '');
  const res = await fetch(`${base}/api/submit-job`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': body.job_id, // MISMO que en body
    },
    body: JSON.stringify(body),
  });

  const diagId = res.headers.get('X-Diag-Id') || '(sin diag)';
  let data = null;
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
