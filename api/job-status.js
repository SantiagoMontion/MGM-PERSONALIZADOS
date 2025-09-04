// api/job-status.js
import { buildCorsHeaders, preflight, applyCorsToResponse } from '../lib/cors';
import getSupabaseAdmin from './_lib/supabaseAdmin';

export default async function handler(req, res) {
  const origin = req.headers.origin || null;
  const cors = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok:false, error: 'method_not_allowed' });
  }
  const { job_id } = req.query || {};
  if (!job_id) return res.status(400).json({ ok:false, error: 'missing_job_id' });

  const supa = getSupabaseAdmin();
  const { data, error } = await supa
    .from('jobs')
    .select('job_id,status,price_amount,price_currency,print_jpg_url,pdf_url,preview_url,material,w_cm,h_cm')
    .eq('job_id', job_id)
    .maybeSingle();

  if (error) return res.status(500).json({ ok:false, error: 'db_error', detail: error.message });
  if (!data) return res.status(404).json({ ok:false, error: 'job_not_found' });

  return res.status(200).json({ ok:true, job: data });
}
