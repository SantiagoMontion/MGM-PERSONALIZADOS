import handler from './_routes/submit-job.js';
import { cors } from './lib/cors.js';
import { randomUUID } from 'node:crypto';

export default async function submitJob(req, res) {
  const diagId = randomUUID?.() || Date.now().toString();
  res.setHeader('X-Diag-Id', diagId);
  if (cors(req, res)) return;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  try {
    return await handler(req, res);
  } catch (e) {
    console.error('submit-job top-level', { diagId, error: e });
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.status(500).json({ ok: false, diag_id: diagId, stage: 'handler', message: 'internal_error' });
  }
}
