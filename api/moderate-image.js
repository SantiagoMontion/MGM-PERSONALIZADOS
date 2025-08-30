import { randomUUID } from 'node:crypto';
import { cors } from './lib/cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST,OPTIONS');
      return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
    }
    return res.status(200).json({ ok: true, diag_id: diagId, allow: true, scores: {}, reason: 'stub' });
  } catch (e) {
    console.error('moderate-image', { diagId, error: e?.message || e });
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    return res.status(500).json({ ok: false, diag_id: diagId, allow: true, reason: 'error' });
  }
}
