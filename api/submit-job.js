import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { cors } from '../lib/cors.js';
import getSupabaseAdmin from './_lib/supabaseAdmin.js';
import { getEnv } from './_lib/env.js';

async function parseBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

export default async function handler(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);

  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, stage: 'validate', message: 'method_not_allowed' });
  }

  let env;
  try {
    env = getEnv();
  } catch (err) {
    console.error('submit-job env', { diagId, stage: 'env', error: err.message });
    return res.status(500).json({
      ok: false,
      diag_id: diagId,
      stage: 'env',
      message: 'Missing environment variables',
      missing: err.missing,
      hints: ['Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE'],
    });
  }

  const body = await parseBody(req);

  const uploadsPrefix = `${env.SUPABASE_URL}/storage/v1/object/uploads/`;

  const schema = z.object({
    job_id: z.string(),
    material: z.string(),
    w_cm: z.preprocess((v) => Number(v), z.number()),
    h_cm: z.preprocess((v) => Number(v), z.number()),
    bleed_mm: z.preprocess((v) => Number(v), z.number()),
    fit_mode: z.string(),
    bg: z.string(),
    dpi: z.preprocess((v) => parseInt(v, 10), z.number().int()),
    file_original_url: z.string().url().refine((u) => u.startsWith(uploadsPrefix), { message: 'must be a Supabase uploads URL' }),
    customer_email: z.string().email().optional(),
    customer_name: z.string().optional(),
    file_hash: z.string().optional(),
    price_amount: z.preprocess((v) => v === undefined ? undefined : Number(v), z.number().optional()),
    price_currency: z.string().optional(),
    notes: z.string().optional(),
    source: z.string().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const missing = [];
    const hints = [];
    for (const issue of parsed.error.issues) {
      if (issue.code === 'invalid_type' && issue.received === 'undefined') {
        missing.push(issue.path.join('.'));
      } else {
        hints.push(`${issue.path.join('.')}: ${issue.message}`);
      }
    }
    console.error('submit-job validate', { diagId, stage: 'validate', issues: parsed.error.issues });
    return res.status(400).json({
      ok: false,
      diag_id: diagId,
      stage: 'validate',
      message: 'Invalid request body',
      missing,
      hints,
    });
  }

  const payload = parsed.data;
  const supabase = getSupabaseAdmin();
  const idKey = req.headers['idempotency-key'] || payload.job_id;
  payload.job_id = idKey;

  try {
    const { data: existing } = await supabase
      .from('jobs')
      .select('*')
      .eq('job_id', idKey)
      .maybeSingle();
    if (existing) {
      return res.status(200).json({ ok: true, job: existing });
    }
  } catch (err) {
    console.error('submit-job select', { diagId, stage: 'supabase_insert', error: err.message });
  }

  try {
    const { data, error } = await supabase
      .from('jobs')
      .insert(payload)
      .select()
      .single();
    if (error) {
      console.error('submit-job insert', { diagId, stage: 'supabase_insert', error: error.message });
      return res.status(400).json({
        ok: false,
        diag_id: diagId,
        stage: 'supabase_insert',
        message: 'Database insert error',
        hints: [],
        supabase: { code: error.code, details: error.details, hint: error.hint },
      });
    }
    return res.status(200).json({ ok: true, job: data });
  } catch (err) {
    console.error('submit-job unknown', { diagId, stage: 'unknown', error: err.message });
    return res.status(500).json({
      ok: false,
      diag_id: diagId,
      stage: 'unknown',
      message: 'Unexpected error',
      hints: [],
    });
  }
}
