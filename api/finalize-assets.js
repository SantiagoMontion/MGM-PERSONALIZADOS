import { withCors } from '../lib/cors';

export default withCors(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    // TODO: implement finalize-assets business logic or keep as stub
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'internal_error', message: e?.message || 'unknown' });
  }
});

