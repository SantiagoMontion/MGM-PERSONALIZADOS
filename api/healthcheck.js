import { withCors } from '../lib/cors';

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  return res.status(200).json({ ok: true, ts: Date.now() });
});

