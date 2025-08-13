import { supa } from '../lib/supa.js';
import { cors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const id = req.query.id; // job_id legible
  if (!id) return res.status(400).json({ error: 'missing_id' });

  const { data, error } = await supa
    .from('jobs')
    .select('job_id,status,material,w_cm,h_cm,price_amount,print_jpg_url,pdf_url,preview_url,checkout_url,shopify_product_url')
    .eq('job_id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(data);
}
