import { cors } from './lib/cors.js';

export default function handler(req, res) {
  if (cors(req, res)) return;
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  res.status(200).json({ origin });
}
