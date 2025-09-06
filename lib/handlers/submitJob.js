import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import { getEnv } from '../_lib/env.js';

export default async function submitJob(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, stage: 'validate', message: 'method_not_allowed' });
  }
  let env;
  try { env = getEnv(); } catch (err) {
    console.error('submit-job env', { diagId, stage: 'env', error: err.message });
    return res.status(500).json({ ok: false, diag_id: diagId, stage: 'env', message: 'Missing environment variables', missing: err.missing });
  }

  // Read body
  const body = await new Promise((resolve) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b||'{}')); } catch { resolve({}); } });
  });

  const uploadsPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/`;
  const schema = z.object({
    job_id: z.string().uuid(),
    material: z.enum(['Classic', 'PRO', 'Glasspad']).default('Classic'),
    w_cm: z.number().positive(),
    h_cm: z.number().positive(),
    bleed_mm: z.number().nonnegative().default(0),
    rotate_deg: z.number().default(0),
    fit_mode: z.enum(['cover', 'contain']).default('cover'),
    bg: z.string().default('#000000'),
    dpi: z.number().int().default(300),
    file_original_url: z.string().url().refine((u) => u.startsWith(uploadsPrefix), { message: `must start with ${uploadsPrefix}` }),
    customer_email: z.string().email().optional(),
    customer_name: z.string().optional(),
    file_hash: z.string().optional(),
    price_amount: z.number().optional(),
    price_currency: z.string().optional(),
    notes: z.string().optional(),
    source: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const missing = [];
    const hints = [];
    for (const issue of parsed.error.issues) {
      if (issue.code === 'invalid_type' && issue.received === 'undefined') missing.push(issue.path.join('.'));
      else hints.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('submit-job validate', { diagId, stage: 'validate', issues: parsed.error.issues });
    return res.status(400).json({ ok: false, diag_id: diagId, stage: 'validate', message: 'Invalid request body', missing, hints, expect: { uploadsPrefix } });
  }
  const input = parsed.data;

  const designName = typeof body?.design_name === 'string' ? body.design_name : undefined;
  const payloadInsert = {
    job_id: input.job_id,
    customer_email: input.customer_email ?? null,
    customer_name: input.customer_name ?? null,
    material: input.material,
    w_cm: input.w_cm,
    h_cm: input.h_cm,
    bleed_mm: input.bleed_mm,
    fit_mode: input.fit_mode,
    bg: input.bg,
    dpi: input.dpi,
    file_original_url: input.file_original_url,
    file_hash: input.file_hash ?? null,
    price_amount: input.price_amount ?? null,
    price_currency: input.price_currency ?? null,
    notes: input.notes ?? null,
    source: input.source ?? 'api',
  };
  if (designName) {
    payloadInsert.notes = (payloadInsert.notes ? payloadInsert.notes + ' | ' : '') + `design_name:${designName}`;
    if (payloadInsert.notes.length > 1000) payloadInsert.notes = payloadInsert.notes.slice(0, 1000);
  }

  const supabase = getSupabaseAdmin();
  try {
    const { data: existing } = await supabase.from('jobs').select('*').eq('job_id', payloadInsert.job_id).maybeSingle();
    if (existing) return res.status(200).json({ ok: true, diag_id: diagId, stage: 'select', job: existing });
  } catch (e) {
    console.error('submit-job select-ex', { diagId, stage: 'select', error: String(e?.message || e) });
  }

  try {
    const { data, error } = await supabase.from('jobs').insert(payloadInsert).select().single();
    if (error) {
      console.error('submit-job insert', { diagId, stage: 'insert', error: error.message, code: error.code, details: error.details, hint: error.hint, payloadInsert });
      return res.status(400).json({ ok: false, diag_id: diagId, stage: 'insert', message: 'db_insert_error', supabase: { code: error.code, message: error.message, details: error.details, hint: error.hint } });
    }
    return res.status(200).json({ ok: true, diag_id: diagId, job: data });
  } catch (e) {
    console.error('submit-job insert-ex', { diagId, stage: 'insert', error: String(e?.message || e) });
    return res.status(500).json({ ok: false, diag_id: diagId, stage: 'insert', message: 'internal_error' });
  }
}

