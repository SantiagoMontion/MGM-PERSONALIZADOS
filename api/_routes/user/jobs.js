import { randomUUID } from 'node:crypto';
import { withObservability } from '../../_lib/observability.js';
import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';
import { verifyUserToken } from '../../_lib/userToken.js';

async function handler(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }
  const { q, email: emailParam, token, page = '1', page_size = '20' } = req.query || {};
  const email = q || emailParam;
  if (!email) return res.status(400).json({ ok: false, diag_id: diagId, message: 'missing_email' });
  if (!verifyUserToken(email, token)) {
    return res.status(401).json({ ok: false, diag_id: diagId, message: 'invalid_token' });
  }
  const pageNum = parseInt(page, 10) || 1;
  const sizeNum = parseInt(page_size, 10) || 20;
  const from = (pageNum - 1) * sizeNum;
  const to = from + sizeNum - 1;
  const supa = getSupabaseAdmin();
  const { data, error } = await supa
    .from('jobs')
    .select('job_id,created_at,design_name,material,w_cm,h_cm,status,preview_url,shopify_product_url,cart_url,checkout_url,legal_version')
    .eq('customer_email', email)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) {
    console.error('user/jobs', { diagId, error: error.message });
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'db_error' });
  }
  return res.status(200).json({ ok: true, diag_id: diagId, jobs: data || [] });
}

export default withObservability(handler);
