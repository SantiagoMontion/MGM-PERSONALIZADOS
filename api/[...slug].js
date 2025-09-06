import { withCors } from '../lib/cors.js';

function pathOf(req) {
  try { const u = new URL(req.url, `http://${req.headers.host}`); return u.pathname.replace(/^\/api\/?/, '').replace(/\/$/, ''); } catch { return ''; }
}

function ensureQuery(req) {
  if (req.query) return;
  try { const u = new URL(req.url, `http://${req.headers.host}`); req.query = Object.fromEntries(u.searchParams); } catch {}
}

export default withCors(async function handler(req, res) {
  const slug = pathOf(req);
  ensureQuery(req);

  if (req.method === 'GET' && slug === 'healthcheck') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify({ ok: true, ts: Date.now() }));
  }

  const key = `${req.method} ${slug}`;
  try {
    switch (key) {
      case 'POST moderate-image': {
        const m = await import('../lib/handlers/moderateImage.js');
        return m.default(req, res);
      }
      case 'POST publish-product': {
        const m = await import('../lib/handlers/publishProduct.js');
        return m.default(req, res);
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
