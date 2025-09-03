import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildCorsHeaders } from '../lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || null;
  const cors = buildCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ error:'origin_not_allowed' });
    Object.entries(cors).forEach(([k,v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  if (!cors) return res.status(403).json({ error:'origin_not_allowed' });
  Object.entries(cors).forEach(([k,v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error:'method_not_allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    // TODO: lógica actual...
    return res.status(200).json({ ok:true });
  } catch (e:any) {
    return res.status(500).json({ error:'internal_error', message: e?.message || 'unknown' });
  }
}
