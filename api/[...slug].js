import { withCors } from '../lib/cors.js';
import { ensureQuery } from '../lib/_lib/http.js';
import { enforceRateLimit } from '../lib/_lib/rateLimit.js';



function normalizeSlug(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.filter(Boolean).join('/');
  }
  if (typeof value === 'string') {
    return value.replace(/^\/+/, '').replace(/\/$/, '');
  }
  return '';
}

function stripApiPrefix(pathname) {
  if (!pathname) return '';
  let current = pathname;
  // Vercel CLI proxies requests through /_vercel/* during development
  current = current.replace(/^\/_vercel\/(?:path\d+\/)?/, '/');


  current = current.replace(/^\/api\/?/, '');
  current = current.replace(/^\/+/, '');
  current = current.replace(/\/$/, '');
  return current;
}

function pathOf(req) {

  const slugFromQuery = normalizeSlug(req?.query?.slug);
  if (slugFromQuery) {
    return stripApiPrefix(`/${slugFromQuery}`);
  }


  const rawUrl = typeof req?.url === 'string' ? req.url : '';
  const headers = req?.headers || {};
  const host = headers.host || headers['x-forwarded-host'] || 'localhost';
  const base = host.includes('://') ? host : `http://${host}`;
  try {
    const url = new URL(rawUrl || '/', base);
    const pathname = url.pathname || '';
    return stripApiPrefix(pathname);
  } catch {
    if (rawUrl.startsWith('/')) {
      return stripApiPrefix(rawUrl);
    }
    return '';
  }
}

const RATE_LIMITS = {
  'POST moderate-image': { limit: 8, windowMs: 60_000 },
  'POST submit-job': { limit: 12, windowMs: 60_000 },
  'POST finalize-assets': { limit: 6, windowMs: 60_000 },
  'POST upload-url': { limit: 30, windowMs: 60_000 },
  'POST cart/link': { limit: 45, windowMs: 60_000 },
  'POST cart/start': { limit: 60, windowMs: 60_000 },
  'POST cart/add': { limit: 90, windowMs: 60_000 },
  'POST create-checkout': { limit: 45, windowMs: 60_000 },
  'POST private/checkout': { limit: 45, windowMs: 60_000 },
  'POST ensure-product-publication': { limit: 30, windowMs: 60_000 },
  'POST variant-status': { limit: 90, windowMs: 60_000 },
  'GET search-assets': { limit: 30, windowMs: 60_000 },
  'GET outputs/search': { limit: 30, windowMs: 60_000 },
  'POST prints/upload': { limit: 12, windowMs: 60_000 },
  'GET prints/search': { limit: 30, windowMs: 60_000 },
  'GET prints/preview': { limit: 60, windowMs: 60_000 },
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
      case 'POST cart/link': {
        const m = await import('../lib/handlers/cartLink.js');
        return m.default(req, res);
      }
      case 'POST cart/start': {
        const m = await import('../lib/handlers/cartStart.js');
        return m.default(req, res);
      }
      case 'POST cart/add': {
        const m = await import('../lib/handlers/cartAdd.js');
        return m.default(req, res);
      }
      case 'POST create-checkout': {
        const m = await import('../lib/handlers/createCheckout.js');
        return m.default(req, res);
      }
      case 'POST private/checkout': {
        const m = await import('../lib/handlers/privateCheckout.js');
        return m.default(req, res);
      }
      case 'POST ensure-product-publication': {
        const m = await import('../lib/handlers/ensureProductPublication.js');
        return m.default(req, res);
      }
      case 'POST variant-status': {
        const m = await import('../lib/handlers/variantStatus.js');
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
      case 'POST upload-original': {
        const m = await import('../lib/handlers/uploadOriginal.js');
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
      case 'GET outputs/search': {
        const { searchOutputFiles } = await import('../lib/api/handlers/outputsSearch.js');
        const { status, body } = await searchOutputFiles({ query: req.query });
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify(body));
      }
      case 'POST prints/upload': {
        const { uploadPrintHandler } = await import('../lib/api/handlers/printsUpload.js');
        return uploadPrintHandler(req, res);
      }
      case 'GET prints/search': {
        const { searchPrintsHandler } = await import('../lib/api/handlers/printsSearch.js');
        const { status, body } = await searchPrintsHandler({ query: req.query, headers: req.headers });
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify(body));
      }
      case 'GET prints/preview': {
        const { default: previewHandler } = await import('../lib/api/handlers/printsPreview.js');
        return previewHandler(req, res);
      }
      case 'GET job-summary': {
        const m = await import('../lib/handlers/jobSummary.js');
        return m.default(req, res);
      }
      case 'GET render-dryrun': {
        const m = await import('../lib/handlers/renderDryrun.js');
        return m.default(req, res);
      }
      case 'GET seo/home': {
        const m = await import('../lib/handlers/seoPages.js');
        return m.seoHome(req, res);
      }
      case 'GET seo/editor': {
        const m = await import('../lib/handlers/seoPages.js');
        return m.seoEditor(req, res);
      }
      case 'GET seo/checkout': {
        const m = await import('../lib/handlers/seoPages.js');
        return m.seoCheckout(req, res);
      }
      case 'GET seo/product': {
        const m = await import('../lib/handlers/seoPages.js');
        return m.seoProduct(req, res);
      }
      case 'POST worker-process': {
        const m = await import('../lib/handlers/workerProcess.js');
        return m.default(req, res);
      }
      case 'POST shopify-webhook': {
        const m = await import('../lib/handlers/shopifyWebhook.js');
        return m.default(req, res);
      }
      case 'GET sitemap.xml': {
        const m = await import('../lib/handlers/sitemap.js');
        return m.default(req, res);
      }
      case 'GET robots.txt': {
        const m = await import('../lib/handlers/robots.js');
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


