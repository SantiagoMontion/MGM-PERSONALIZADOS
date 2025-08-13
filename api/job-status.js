import { supa } from '../lib/supa.js';
import { cors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const id = req.query.id; // puede ser job_id legible o el uuid con un flag
  if (!id) return res.status(400).json({ error: 'missing_id' });

  // buscamos por job_id (legible)
  const { data, error } = await supa
    .from('jobs')
    .select('job_id,status,print_jpg_url,pdf_url,preview_url,checkout_url')
    .eq('job_id', id)
    .single();

  if (error) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(data);
}
