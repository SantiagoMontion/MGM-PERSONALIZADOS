import { randomUUID } from 'node:crypto';
import { supa } from '../../lib/supa.js';
import { cors } from '../lib/cors.js';

export default async function handler(req, res) {
  const diagId = randomUUID?.() || Date.now().toString();
  res.setHeader('X-Diag-Id', diagId);
  if (cors(req, res)) return;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  const id = req.query.id; // job_id legible
  if (!id) return res.status(400).json({ error: 'missing_id' });

  let { data, error } = await supa
    .from('jobs')
    .select('job_id,status,material,w_cm,h_cm,price_amount,print_jpg_url,pdf_url,preview_url,checkout_url,shopify_product_url')
    .eq('job_id', id)
    .limit(2)
    .maybeSingle();

  if (error) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    return res.status(500).json({ error: 'unknown_error' });
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return res.status(404).json({ error: 'not_found' });
    if (data.length > 1) return res.status(409).json({ error: 'duplicate' });
    data = data[0];
  }
  if (!data) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(data);
}
