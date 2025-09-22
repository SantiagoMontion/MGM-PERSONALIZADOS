import { withCors } from '../lib/cors.js';
import { ensureQuery } from '../lib/_lib/http.js';
import { enforceRateLimit } from '../lib/_lib/rateLimit.js';

function pathOf(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  } catch {
    return '';
  }
}

const RATE_LIMITS = {
  'POST moderate-image': { limit: 8, windowMs: 60_000 },
  'POST submit-job': { limit: 12, windowMs: 60_000 },
  'POST finalize-assets': { limit: 6, windowMs: 60_000 },
  'POST upload-url': { limit: 30, windowMs: 60_000 },
  'POST create-cart-link': { limit: 45, windowMs: 60_000 },
  'POST create-checkout': { limit: 45, windowMs: 60_000 },
  'GET search-assets': { limit: 30, windowMs: 60_000 },
  'POST shopify-webhook': { limit: 60, windowMs: 60_000 },
};

export default withCors(async function handler(req, res) {
  const slug = pathOf(req);
  ensureQuery(req);

  if (req.method === 'GET' && slug === 'healthcheck') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify({ ok: true, ts: Date.now() }));
  }

  const key = `${req.method} ${slug}`;
  const limitConfig = RATE_LIMITS[key];
  if (limitConfig) {
    const allowed = enforceRateLimit(req, res, { ...limitConfig, scope: key });
    if (!allowed) return;
  }

  try {
    switch (key) {
      case 'POST moderate-image': {
        const m = await import('../lib/handlers/moderateImage.js');
        return m.default(req, res);
      }
      case 'POST publish-product': {
        const { publishProduct } = await import('../lib/handlers/publishProduct.js');
        return publishProduct(req, res);
      }
      case 'POST create-cart-link': {
        const m = await import('../lib/handlers/createCartLink.js');
        return m.default(req, res);
      }
      case 'POST create-checkout': {
        const m = await import('../lib/handlers/createCheckout.js');
        return m.default(req, res);
      }
      case 'POST finalize-assets': {
        const m = await import('../lib/handlers/finalizeAssets.js');
        return m.default(req, res);
      }
      case 'POST upload-url': {
        const m = await import('../lib/handlers/uploadUrl.js');
        return m.default(req, res);
      }
      case 'POST submit-job': {
        const m = await import('../lib/handlers/submitJob.js');
        return m.default(req, res);
      }
      case 'GET job-status': {
        const m = await import('../lib/handlers/jobStatus.js');
        return m.default(req, res);
      }
      case 'GET search-assets': {
        const { searchAssets } = await import('../lib/api/handlers/assets.js');
        const { status, body } = await searchAssets({ query: req.query });
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify(body));
      }
      case 'GET job-summary': {
        const m = await import('../lib/handlers/jobSummary.js');
        return m.default(req, res);
      }
      case 'GET render-dryrun': {
        const m = await import('../lib/handlers/renderDryrun.js');
        return m.default(req, res);
      }
      case 'POST worker-process': {
        const m = await import('../lib/handlers/workerProcess.js');
        return m.default(req, res);
      }
      case 'POST shopify-webhook': {
        const m = await import('../lib/handlers/shopifyWebhook.js');
        return m.default(req, res);
      }
      default: {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'not_found', path: slug }));
      }
    }
  } catch (err) {
    try { console.error('[router]', key, err); } catch {}
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, code: 'handler_error' }));
  }
});
