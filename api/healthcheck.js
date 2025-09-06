import { withCors } from '../lib/cors';

export default withCors((req, res) => {
  // CORS preflight handled in withCors (204)
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, ts: Date.now() }));
});

