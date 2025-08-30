import { randomUUID } from 'node:crypto';
import { cors } from './lib/cors.js';

export default function handler(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  if (cors(req, res)) return;
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  res.status(200).json({ origin, allowedEnv: process.env.ALLOWED_ORIGINS, diag_id: diagId });
}
