import { withCors } from '../lib/cors.js';
import createCartLink from '../lib/handlers/createCartLink.js';
import createCheckout from '../lib/handlers/createCheckout.js';
import publishProduct from '../lib/handlers/publishProduct.js';
import moderateImage from '../lib/handlers/moderateImage.js';
import finalizeAssets from '../lib/handlers/finalizeAssets.js';
import uploadUrl from '../lib/handlers/uploadUrl.js';
import submitJob from '../lib/handlers/submitJob.js';
import jobStatus from '../lib/handlers/jobStatus.js';
import jobSummary from '../lib/handlers/jobSummary.js';
import renderDryrun from '../lib/handlers/renderDryrun.js';
import workerProcess from '../lib/handlers/workerProcess.js';
import shopifyWebhook from '../lib/handlers/shopifyWebhook.js';

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
  switch (key) {
    case 'POST moderate-image':
      return moderateImage(req, res);
    case 'POST publish-product':
      return publishProduct(req, res);
    case 'POST create-cart-link':
      return createCartLink(req, res);
    case 'POST create-checkout':
      return createCheckout(req, res);
    case 'POST finalize-assets':
      return finalizeAssets(req, res);
    case 'POST upload-url':
      return uploadUrl(req, res);
    case 'POST submit-job':
      return submitJob(req, res);
    case 'GET job-status':
      return jobStatus(req, res);
    case 'GET job-summary':
      return jobSummary(req, res);
    case 'GET render-dryrun':
      return renderDryrun(req, res);
    case 'POST worker-process':
      return workerProcess(req, res);
    case 'POST shopify-webhook':
      return shopifyWebhook(req, res);
    default:
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'not_found', path: slug }));
  }
});
