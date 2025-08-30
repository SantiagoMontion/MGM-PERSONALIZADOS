import crypto from 'node:crypto';
import { supa } from '../../lib/supa.js';

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));


  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const termRaw = String(req.query.term || '').trim();
  if (!termRaw) return res.status(400).json({ error: 'missing_term' });

  try {
    const term = termRaw.replace(/%/g, '');
    const { data, error } = await supa
      .from('jobs')
      .select('job_id,design_name,material,w_cm,h_cm,file_original_url,created_at')
      .or(`design_name.ilike.%${term}%,material.ilike.%${term}%`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    return res.status(200).json({ items: data });
  } catch (e) {
    console.error('search-assets', e);
    return res.status(500).json({ error: 'search_failed' });
  }
}
