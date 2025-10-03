import { resolveEnvRequirements, collectMissingEnv } from './_lib/envChecks.js';
import { createDiagId, logApiError } from './_lib/diag.js';

const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';
const FRONT_ORIGIN = (process.env.FRONT_ORIGIN || 'https://mgm-app.vercel.app').replace(/\/$/, '');
const REQUIRED_ENV = resolveEnvRequirements('SHOPIFY_ADMIN', 'SUPABASE_SERVICE');
const SHOPIFY_TIMEOUT_STATUS = 504;

export const config = { memory: 256, maxDuration: 60 };

function createRid() {
  const base = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${base}${random}`;
}

function resolveCorsOrigin(req) {
  if (typeof req?.headers?.origin === 'string') {
    const value = req.headers.origin.trim();
    if (value) {
      return value;
    }
  }
  return '*';
}

function resolveRequestedHeaders(req) {
  const raw = req?.headers?.['access-control-request-headers'];
  let headerList = '';

  if (Array.isArray(raw)) {
    headerList = raw.join(',');
  } else if (typeof raw === 'string') {
    headerList = raw;
  }

  if (!headerList) {
    return 'content-type, authorization';
  }

  const names = headerList
    .split(',')
    .map((name) => name.split(':')[0].trim())
    .filter(Boolean);

  return names.length ? names.join(', ') : 'content-type, authorization';
}

function applyCors(req, res) {
  const origin = resolveCorsOrigin(req);
  const allowHeaders = resolveRequestedHeaders(req);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', allowHeaders);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function sendJson(req, res, status, payload) {
  applyCors(req, res);
  res.statusCode = status;
  res.end(JSON.stringify(payload ?? {}));
}

function resolveShopDomain() {
  const candidates = [process.env.SHOPIFY_STORE_DOMAIN, process.env.SHOPIFY_SHOP];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function validateRealConfig(req, res, diagId) {
  const missing = collectMissingEnv(REQUIRED_ENV);
  if (missing.length) {
    logApiError('publish-product', { diagId, step: 'missing_env', error: `missing_env:${missing.join(',')}` });
    sendJson(req, res, 400, { ok: false, error: 'missing_env', missing, diagId });
    return null;
  }

  const domain = resolveShopDomain();
  if (!domain || !/\.myshopify\.com$/i.test(domain)) {
    logApiError('publish-product', { diagId, step: 'invalid_shop_domain', error: domain || 'missing_domain' });
    sendJson(req, res, 400, { ok: false, error: 'invalid_shop_domain', diagId });
    return null;
  }

  return { domain };
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'mock-product';
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('payload_too_large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function buildMockProduct(payload) {
  const visibility = payload?.visibility === 'private' ? 'private' : 'public';
  const design = typeof payload?.designName === 'string' ? payload.designName.trim() : '';
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  const handleBase = design || title || 'mock-product';
  const handle = slugify(handleBase).slice(0, 64) || 'mock-product';
  const now = Date.now();
  const rid = createRid();
  const productId = `mock_${rid}`;
  const variantNumeric = `${Math.floor(Math.random() * 9_000_000) + 1_000_000}`;
  const variantGid = `gid://shopify/ProductVariant/${variantNumeric}`;
  const productUrl = `${FRONT_ORIGIN}/mockup?rid=${encodeURIComponent(rid)}&from=publish`;

  return {
    ok: true,
    stub: true,
    visibility,
    productId,
    productHandle: handle,
    handle,
    productUrl,
    url: productUrl,
    publicUrl: productUrl,
    variantId: variantGid,
    variantGid,
    variantIdNumeric: variantNumeric,
    createdAt: new Date(now).toISOString(),
    warnings: [],
    warningMessages: [],
  };
}

export default async function handler(req, res) {
  const diagId = createDiagId();
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }
  if ((req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendJson(req, res, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  if (!SHOPIFY_ENABLED) {
    let body = null;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      body = null;
    }
    const payload = { ...buildMockProduct(body || {}), diagId };
    sendJson(req, res, 200, payload);
    return;
  }

  const configOk = validateRealConfig(req, res, diagId);
  if (!configOk) {
    return;
  }

  try {
    const mod = await import('../api-routes/publish-product.js');
    const realHandler = mod?.default || mod;
    if (typeof realHandler !== 'function') {
      logApiError('publish-product', { diagId, step: 'handler_missing', error: 'handler_not_found' });
      sendJson(req, res, 200, { ok: true, stub: true, message: 'not_implemented', diagId });
      return;
    }
    req.mgmDiagId = diagId;
    await realHandler(req, res);
  } catch (err) {
    const step = err?.code === 'SHOPIFY_TIMEOUT' ? err?.step || 'shopify_request' : 'real_handler';
    logApiError('publish-product', { diagId, step, error: err });
    if (!res.headersSent) {
      if (err?.code === 'SHOPIFY_TIMEOUT') {
        sendJson(req, res, SHOPIFY_TIMEOUT_STATUS, {
          ok: false,
          error: 'shopify_timeout',
          diagId,
          step,
        });
        return;
      }
      sendJson(req, res, 502, {
        ok: false,
        error: 'publish_failed',
        diagId,
      });
    }
  }
}
