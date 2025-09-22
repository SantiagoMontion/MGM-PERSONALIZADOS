import { z } from 'zod';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import { ensureQuery } from '../_lib/http.js';

const QuerySchema = z.object({
  job_id: z
    .string()
    .trim()
    .min(8, 'job_id must be at least 8 characters')
    .max(64, 'job_id too long')
    .regex(/^[A-Za-z0-9_-]+$/, 'job_id has invalid characters'),
});

export default async function jobStatus(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const query = ensureQuery(req);
  const parsed = QuerySchema.safeParse(query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_job_id',
      issues: parsed.error.flatten().fieldErrors,
    });
  }
  const { job_id } = parsed.data;

  let supa;
  try {
    supa = getSupabaseAdmin();
  } catch (err) {
    console.error('job-status env', err);
    return res.status(500).json({ ok: false, error: 'missing_env', detail: err?.message });
  }
  const { data, error } = await supa
    .from('jobs')
    .select('job_id,status,price_amount,price_currency,print_jpg_url,pdf_url,preview_url,material,w_cm,h_cm')
    .eq('job_id', job_id)
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: 'db_error', detail: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'job_not_found' });

  return res.status(200).json({ ok: true, job: data });
}

