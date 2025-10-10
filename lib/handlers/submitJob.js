import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import { getEnv } from '../_lib/env.js';
import logger from '../_lib/logger.js';

export default async function submitJob(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, stage: 'validate', message: 'method_not_allowed' });
  }
  let env;
  try { env = getEnv(); } catch (err) {
    logger.error('submit-job env', { diagId, stage: 'env', error: err.message });
    return res.status(500).json({ ok: false, diag_id: diagId, stage: 'env', message: 'Missing environment variables', missing: err.missing });
  }

  // Read body
  const body = await new Promise((resolve) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b||'{}')); } catch { resolve({}); } });
  });

  const uploadsPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/`;
  function validateSubmitBody(b){
    const missing=[]; const hints=[];
    if (!b || typeof b !== 'object') return { ok:false, missing:['body'], hints:['invalid_body'] };
    const out = {};
    if (typeof b.job_id !== 'string' || b.job_id.length < 8) missing.push('job_id'); else out.job_id = b.job_id;
    const mat = (b.material || 'Classic');
    if (!['Classic','PRO','Glasspad'].includes(mat)) hints.push('material: invalid');
    out.material = ['Classic','PRO','Glasspad'].includes(mat) ? mat : 'Classic';
    if (typeof b.w_cm !== 'number' || !(b.w_cm > 0)) missing.push('w_cm'); else out.w_cm = b.w_cm;
    if (typeof b.h_cm !== 'number' || !(b.h_cm > 0)) missing.push('h_cm'); else out.h_cm = b.h_cm;
    out.bleed_mm = (typeof b.bleed_mm === 'number' && b.bleed_mm >= 0) ? b.bleed_mm : 0;
    out.rotate_deg = (typeof b.rotate_deg === 'number') ? b.rotate_deg : 0;
    out.fit_mode = (b.fit_mode === 'contain' || b.fit_mode === 'cover') ? b.fit_mode : 'cover';
    out.bg = typeof b.bg === 'string' ? b.bg : '#000000';
    out.dpi = Number.isInteger(b.dpi) ? b.dpi : 300;
    if (typeof b.file_original_url !== 'string' || !b.file_original_url.startsWith(uploadsPrefix)) {
      missing.push('file_original_url');
      hints.push(`file_original_url: must start with ${uploadsPrefix}`);
    } else out.file_original_url = b.file_original_url;
    if (b.customer_email && (typeof b.customer_email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.customer_email))) hints.push('customer_email: invalid'); else out.customer_email = b.customer_email ?? null;
    out.customer_name = typeof b.customer_name === 'string' ? b.customer_name : null;
    out.file_hash = typeof b.file_hash === 'string' ? b.file_hash : null;
    if (b.price_amount != null && typeof b.price_amount !== 'number') hints.push('price_amount: invalid'); else out.price_amount = b.price_amount ?? null;
    out.price_currency = typeof b.price_currency === 'string' ? b.price_currency : null;
    out.notes = typeof b.notes === 'string' ? b.notes : null;
    out.source = typeof b.source === 'string' ? b.source : 'api';
    const lowAck = b.low_quality_ack ?? b.lowQualityAck;
    if (lowAck !== undefined) {
      if (typeof lowAck === 'boolean') {
        out.low_quality_ack = lowAck;
      } else {
        hints.push('low_quality_ack: invalid');
      }
    }
    if (missing.length || hints.length) return { ok:false, missing, hints };
    return { ok:true, data: out };
  }
  const v = validateSubmitBody(body);
  if (!v.ok) {
    logger.error('submit-job validate', { diagId, stage: 'validate', issues: v });
    return res.status(400).json({ ok:false, diag_id: diagId, stage:'validate', message:'Invalid request body', missing:v.missing, hints:v.hints, expect:{ uploadsPrefix } });
  }
  const input = v.data;

  const designNameRaw = typeof body?.design_name === 'string' ? body.design_name.trim() : '';
  const designName = designNameRaw ? designNameRaw : undefined;
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
  if ('low_quality_ack' in input) {
    payloadInsert.low_quality_ack = input.low_quality_ack;
  }
  if (designName) {
    payloadInsert.design_name = designName.slice(0, 250);
    payloadInsert.notes = (payloadInsert.notes ? payloadInsert.notes + ' | ' : '') + `design_name:${designName}`;
    if (payloadInsert.notes.length > 1000) payloadInsert.notes = payloadInsert.notes.slice(0, 1000);
  }

  const supabase = getSupabaseAdmin();
  try {
    const { data: existing } = await supabase.from('jobs').select('*').eq('job_id', payloadInsert.job_id).maybeSingle();
    if (existing) return res.status(200).json({ ok: true, diag_id: diagId, stage: 'select', job: existing });
  } catch (e) {
    logger.error('submit-job select-ex', { diagId, stage: 'select', error: String(e?.message || e) });
  }

  try {
    const { data, error } = await supabase.from('jobs').insert(payloadInsert).select().single();
    if (error) {
      logger.error('submit-job insert', { diagId, stage: 'insert', error: error.message, code: error.code, details: error.details, hint: error.hint, payloadInsert });
      return res.status(400).json({ ok: false, diag_id: diagId, stage: 'insert', message: 'db_insert_error', supabase: { code: error.code, message: error.message, details: error.details, hint: error.hint } });
    }
    return res.status(200).json({ ok: true, diag_id: diagId, job: data });
  } catch (e) {
    logger.error('submit-job insert-ex', { diagId, stage: 'insert', error: String(e?.message || e) });
    return res.status(500).json({ ok: false, diag_id: diagId, stage: 'insert', message: 'internal_error' });
  }
}

