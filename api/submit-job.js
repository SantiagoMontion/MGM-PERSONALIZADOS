// /api/submit-job.js
// Receives job payload and stores it in supabase.
// Returns the created job row. Triggers worker-process asynchronously.
import crypto from 'node:crypto';
import { z } from 'zod';
import { supa } from '../lib/supa.js';
import { cors } from './_lib/cors.js';

const BodySchema = z.object({
  job_id: z.string().min(1),
  material: z.string(),
  w_cm: z.number(),
  h_cm: z.number(),
  bleed_mm: z.number().optional(),
  fit_mode: z.string().optional(),
  bg: z.string().optional(),
  dpi: z.number(),
  file_original_url: z.string().url(),
  customer_email: z.string().email().optional(),
  customer_name: z.string().optional(),
  file_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  price_amount: z.number().optional(),
  price_currency: z.string().optional(),
  notes: z.string().optional(),
  source: z.string().optional(),
  design_name: z.string().optional(),
});

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  try {
    const body = BodySchema.parse(req.body || {});

    const { data, error } = await supa
      .from('jobs')
      .insert({
        job_id: body.job_id,
        status: 'UPLOADED',
        material: body.material,
        w_cm: body.w_cm,
        h_cm: body.h_cm,
        bleed_mm: body.bleed_mm,
        fit_mode: body.fit_mode,
        bg: body.bg,
        dpi: body.dpi,
        file_original_url: body.file_original_url,
        file_hash: body.file_hash,
        customer_email: body.customer_email,
        customer_name: body.customer_name,
        price_amount: body.price_amount,
        price_currency: body.price_currency,
        notes: body.notes,
        source: body.source,
        design_name: body.design_name || body.notes || null,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('submit_job_insert_failed', error);
      return res.status(500).json({ stage: 'insert', error: 'insert_failed' });
    }

    const workerBase = (process.env.API_BASE_URL || '').replace(/\/$/, '');
    const workerToken = process.env.WORKER_TOKEN || '';
    if (workerBase && workerToken) {
      fetch(`${workerBase}/api/worker-process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ job_id_uuid: data.id }),
      }).catch(() => {});
    }

    return res.status(200).json({ job: data });
  } catch (e) {
    if (e?.issues) {
      return res.status(400).json({ stage: 'validation', error: 'invalid_body', issues: e.issues });
    }
    console.error('submit_job_error', e);
    return res.status(500).json({ stage: 'crash', error: String(e?.message || e) });
  }
}

