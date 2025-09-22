import crypto from 'node:crypto';
import { z } from 'zod';
import { supa } from '../supa.js';
import { ensureQuery } from '../_lib/http.js';

const QuerySchema = z.object({
  id: z
    .string()
    .trim()
    .min(8, 'id must be at least 8 characters')
    .max(64, 'id too long')
    .regex(/^[A-Za-z0-9_-]+$/, 'id has invalid characters'),
});

export default async function jobSummary(req, res) {
  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }
  const query = ensureQuery(req);
  const parsed = QuerySchema.safeParse(query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      diag_id: diagId,
      error: 'invalid_id',
      issues: parsed.error.flatten().fieldErrors,
    });
  }
  const { id } = parsed.data;

  let { data, error } = await supa
    .from('jobs')
    .select('job_id,status,material,w_cm,h_cm,price_amount,print_jpg_url,pdf_url,preview_url,checkout_url,shopify_product_url')
    .eq('job_id', id)
    .limit(2)
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, diag_id: diagId, error: 'unknown_error' });
  if (Array.isArray(data)) {
    if (data.length === 0) return res.status(404).json({ ok: false, diag_id: diagId, error: 'not_found' });
    if (data.length > 1) return res.status(409).json({ ok: false, diag_id: diagId, error: 'duplicate' });
    data = data[0];
  }

  return res.status(200).json(data || {});
}

