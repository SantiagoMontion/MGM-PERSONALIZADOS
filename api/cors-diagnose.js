import { cors } from './_lib/cors.js';

export default function handler(req, res) {
  const ended = cors(req, res);

  const origin = (req.headers.origin || '').replace(/\/$/, '');
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/\/$/, ''));
  console.log('[cors-diagnose]', { origin, allowed });

  if (!ended) {
    res.status(204).end();
  }
}
