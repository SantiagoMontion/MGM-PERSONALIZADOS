import crypto from 'node:crypto';
import { supa } from '../lib/supa.js';
import { cors } from './_lib/cors.js';

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  const id = req.query.id; // puede ser job_id legible o el uuid con un flag
  if (!id) return res.status(400).json({ error: 'missing_id' });

  // buscamos por job_id (legible)
  let { data, error } = await supa
    .from('jobs')
    .select('job_id,status,print_jpg_url,pdf_url,preview_url,checkout_url')
    .eq('job_id', id)
    .limit(2)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'unknown_error' });
  if (Array.isArray(data)) {
    if (data.length === 0) return res.status(404).json({ error: 'not_found' });
    if (data.length > 1) return res.status(409).json({ error: 'duplicate' });
    data = data[0];
  }
  if (!data) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(data);
}
