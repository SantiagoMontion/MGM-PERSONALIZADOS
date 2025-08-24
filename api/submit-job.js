import supabase from './_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const required = ['job_id','material','w_cm','h_cm','bleed_mm','fit_mode','bg','dpi','file_original_url'];
  const missing = required.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) {
    return res.status(400).json({ error: 'missing_fields', fields: missing });
  }

  const { mode, ...payload } = body;

  try {
    let data, error;
    if (mode === 'upsert') {
      ({ data, error } = await supabase
        .from('jobs')
        .upsert(payload, { onConflict: 'job_id' })
        .select()
        .single());
    } else {
      ({ data, error } = await supabase
        .from('jobs')
        .insert(payload)
        .select()
        .single());
    }

    if (error) throw error;
    return res.status(200).json(data);
  } catch (err) {
    console.error('submit-job error', err);
    return res.status(500).json({ error: 'database_error' });
  }
}
