import { randomUUID } from "node:crypto";
import { cors } from './lib/cors.js';
import { withObservability } from './_lib/observability.js';

const routes = {
  'post /api/upload-url': () => import('./_routes/upload-url.js'),
  'post /api/submit-job': () => import('./_routes/submit-job.js'),
  'post /api/finalize-assets': () => import('./_routes/finalize-assets.js'),
  'post /api/create-cart-link': () => import('./_routes/create-cart-link.js'),
  'post /api/create-checkout': () => import('./_routes/create-checkout.js'),
  'post /api/publish-product': () => import('./_routes/publish-product.js'),
  'post /api/render-dryrun': () => import('./_routes/render-dryrun.js'),
  'get /api/job-status': () => import('./_routes/job-status.js'),
  'get /api/job-summary': () => import('./_routes/job-summary.js'),
  'get /api/search-assets': () => import('./_routes/search-assets.js'),
  'get /api/env-check': () => import('./_routes/env-check.js'),
  'get /api/diag-cors': () => import('./diag-cors.js'),
  'get /api/admin/search-jobs': () => import('./_routes/admin/search-jobs.js'),
  'get /api/user/jobs': () => import('./_routes/user/jobs.js'),
  'post /api/user/login-link': () => import('./_routes/user/login-link.js'),
};

export default withObservability(async function handler(req, res) {
  const diagId = randomUUID();
  res.setHeader("X-Diag-Id", diagId);
  if (cors(req, res)) return;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = url.pathname.replace(/\/$/, '');
    const method = (req.method || 'GET').toLowerCase();
    const key = `${method} ${pathname.toLowerCase()}`;

    const loader = routes[key];
    if (loader) {
      const mod = await loader();
      return mod.default(req, res);
    }
    res.status(404).json({ ok: false, message: 'not_found' });
  } catch (e) {
    console.error('index handler', { diagId, error: e?.message || e });
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.status(500).json({ ok: false, diag_id: diagId, stage: 'handler', message: 'internal_error' });
  }
});
