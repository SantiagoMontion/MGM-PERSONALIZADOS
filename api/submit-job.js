import handler from './_routes/submit-job.js';
import { cors } from './lib/cors.js';

export default async function submitJob(req, res) {
  if (cors(req, res)) return;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  try {
    return await handler(req, res);
  } catch (e) {
    console.error('submit-job top-level', e);
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
