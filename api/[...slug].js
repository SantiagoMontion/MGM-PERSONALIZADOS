import createCheckout from '../api-routes/create-checkout.js';
import ensureProductPublication from '../api-routes/ensure-product-publication.js';
import finalizeAssets from '../api-routes/finalize-assets.js';
import healthcheck from '../api-routes/healthcheck.js';
import jobStatus from '../api-routes/job-status.js';
import jobSummary from '../api-routes/job-summary.js';
import moderateImage from '../api-routes/moderate-image.js';
import publishProduct from '../api-routes/publish-product.js';
import renderDryrun from '../api-routes/render-dryrun.js';
import robotsTxt from '../api-routes/robots.txt.js';
import searchAssets from '../api-routes/search-assets.js';
import shopifyWebhook from '../api-routes/shopify-webhook.js';
import sitemapXml from '../api-routes/sitemap.xml.js';
import submitJob from '../api-routes/submit-job.js';
import uploadOriginal from '../api-routes/upload-original.js';
import uploadUrl from '../api-routes/upload-url.js';
import variantStatus from '../api-routes/variant-status.js';
import workerProcess from '../api-routes/worker-process.js';
import cartAdd from '../api-routes/cart/add.js';
import cartLink from '../api-routes/cart/link.js';
import cartStart from '../api-routes/cart/start.js';
import outputsSearch from '../api-routes/outputs/search.js';
import printsHealth from '../api-routes/prints/health.js';
import printsPreview from '../api-routes/prints/preview.js';
import printsSearch from '../api-routes/prints/search.js';
import printsUpload from '../api-routes/prints/upload.js';
import privateCheckout from '../api-routes/private/checkout/index.js';
import seoCheckout from '../api-routes/seo/checkout.js';
import seoEditor from '../api-routes/seo/editor.js';
import seoHome from '../api-routes/seo/home.js';
import seoProduct from '../api-routes/seo/product.js';

const ROUTES = new Map([
  ['POST /api/create-checkout', createCheckout],
  ['POST /api/ensure-product-publication', ensureProductPublication],
  ['POST /api/finalize-assets', finalizeAssets],
  ['GET /api/healthcheck', healthcheck],
  ['GET /api/job-status', jobStatus],
  ['GET /api/job-summary', jobSummary],
  ['POST /api/moderate-image', moderateImage],
  ['POST /api/publish-product', publishProduct],
  ['GET /api/render-dryrun', renderDryrun],
  ['GET /api/robots.txt', robotsTxt],
  ['GET /api/search-assets', searchAssets],
  ['POST /api/shopify-webhook', shopifyWebhook],
  ['GET /api/sitemap.xml', sitemapXml],
  ['POST /api/submit-job', submitJob],
  ['POST /api/upload-original', uploadOriginal],
  ['POST /api/upload-url', uploadUrl],
  ['GET /api/variant-status', variantStatus],
  ['POST /api/worker-process', workerProcess],
  ['POST /api/cart/add', cartAdd],
  ['POST /api/cart/link', cartLink],
  ['POST /api/cart/start', cartStart],
  ['GET /api/outputs/search', outputsSearch],
  ['GET /api/prints/health', printsHealth],
  ['GET /api/prints/preview', printsPreview],
  ['GET /api/prints/search', printsSearch],
  ['POST /api/prints/upload', printsUpload],
  ['POST /api/private/checkout', privateCheckout],
  ['GET /api/seo/checkout', seoCheckout],
  ['GET /api/seo/editor', seoEditor],
  ['GET /api/seo/home', seoHome],
  ['GET /api/seo/product', seoProduct],
  ['GET /api/ping', (req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true }));
  }],
]);

function findHandler(method, pathname) {
  const key = `${method} ${pathname}`;
  let handler = ROUTES.get(key);
  if (!handler && method === 'HEAD') {
    handler = ROUTES.get(`GET ${pathname}`);
  }
  return handler;
}

function getPathname(req) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    return url.pathname;
  } catch {
    const raw = req.url || '';
    const index = raw.indexOf('?');
    return index === -1 ? raw : raw.slice(0, index);
  }
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const pathname = getPathname(req);
  const handler = findHandler(method, pathname);
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    return;
  }
  return handler(req, res);
}
