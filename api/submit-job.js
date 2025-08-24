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

  // CORS / preflight
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, diag_id: diagId, stage: 'validate', message: 'method_not_allowed' });
  }

  // ENV
  let env;
  try {
    env = getEnv();
  } catch (err) {
    console.error('submit-job env', { diagId, stage: 'env', error: err.message });
    return res.status(500).json({
      ok: false, diag_id: diagId, stage: 'env',
      message: 'Missing environment variables',
      missing: err.missing,
      hints: ['Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE'],
    });
  }

  const body = await parseBody(req);

  // Prefix esperado (uploads PRIVADO). Si algún día usás público, agregá /public/ en el refine.
  const uploadsPrefix = `${env.SUPABASE_URL}/storage/v1/object/uploads/`;

  // Validación
  const schema = z.object({
    job_id: z.string(),
    material: z.string(),
    w_cm: z.preprocess((v) => Number(v), z.number()),
    h_cm: z.preprocess((v) => Number(v), z.number()),
    bleed_mm: z.preprocess((v) => Number(v), z.number()),
    fit_mode: z.string(),
    bg: z.string(),
    dpi: z.preprocess((v) => parseInt(v, 10), z.number().int()),
    file_original_url: z.string().url().refine(
      (u) => u.startsWith(uploadsPrefix),
      { message: `must start with ${uploadsPrefix}` }
    ),
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
    console.error('submit-job validate', { diagId, stage: 'validate', issues: parsed.error.issues, uploadsPrefix });
    return res.status(400).json({
      ok: false,
      diag_id: diagId,
      stage: 'validate',
      message: 'Invalid request body',
      missing,
      hints,
      expect: { uploadsPrefix }
    });
  }

  const payload = parsed.data;
  const supabase = getSupabaseAdmin();

  // Idempotencia: usá header si viene, si no el job_id del body
  const idKey = req.headers['idempotency-key'] || payload.job_id;
  payload.job_id = idKey;

  // Si ya existe, devolvelo
  try {
    const { data: existing, error: selErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('job_id', idKey)
      .maybeSingle();

    if (selErr) {
      console.error('submit-job select', { diagId, stage: 'supabase_select', error: selErr.message, code: selErr.code });
    } else if (existing) {
      return res.status(200).json({ ok: true, job: existing, reused: true });
    }
  } catch (err) {
    console.error('submit-job select-unknown', { diagId, stage: 'supabase_select', error: err.message });
  }

  // Insert
  try {
    const { data, error } = await supabase
      .from('jobs')
      .insert([payload])   // <- array para evitar edge cases
      .select()
      .single();

    if (error) {
      console.error('submit-job insert', { diagId, stage: 'supabase_insert', error: error.message, code: error.code });
      return res.status(400).json({
        ok: false, diag_id: diagId, stage: 'supabase_insert',
        message: 'Database insert error',
        hints: [],
        supabase: { code: error.code, details: error.details, hint: error.hint }
      });
    }
    return res.status(201).json({ ok: true, job: data });
  } catch (err) {
    console.error('submit-job unknown', { diagId, stage: 'unknown', error: err.message });
    return res.status(500).json({
      ok: false, diag_id: diagId, stage: 'unknown',
      message: 'Unexpected error',
      hints: [],
    });
  }
}
