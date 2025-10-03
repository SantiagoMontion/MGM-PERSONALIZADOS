import { buildStubRequestId, resolveFrontOrigin } from '../lib/_lib/stubHelpers.js';
import { runWithLenientCors, sendCorsOptions, sendJsonWithCors } from './_lib/lenientCors.js';
import { resolveEnvRequirements, collectMissingEnv } from './_lib/envChecks.js';
import { createDiagId, logApiError } from './_lib/diag.js';

const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';
const REQUIRED_ENV = resolveEnvRequirements('SHOPIFY_STOREFRONT');
const SHOPIFY_TIMEOUT_STATUS = 504;

function buildStubCheckoutPayload() {
  const rid = buildStubRequestId();
  const origin = resolveFrontOrigin();
  const checkoutUrl = `${origin}/mockup?rid=${encodeURIComponent(rid)}&step=checkout&from=create-checkout`;

  return {
    ok: true,
    stub: true,
    url: checkoutUrl,
    checkoutUrl,
    message: null,
    missing: [],
  };
}

async function proxyRealHandler(req, res) {
  await runWithLenientCors(req, res, async () => {
    const mod = await import('../api-routes/create-checkout.js');
    const handler = mod?.default || mod;
    if (typeof handler !== 'function') {
      throw new Error('handler_not_found');
    }
    return handler(req, res);
  });
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
    logApiError('create-checkout', { diagId, step: 'missing_env', error: `missing_env:${missing.join(',')}` });
    sendJsonWithCors(req, res, 400, { ok: false, error: 'missing_env', missing, diagId });
    return false;
  }

  const domain = resolveShopDomain();
  if (!domain || !/\.myshopify\.com$/i.test(domain)) {
    logApiError('create-checkout', { diagId, step: 'invalid_shop_domain', error: domain || 'missing_domain' });
    sendJsonWithCors(req, res, 400, { ok: false, error: 'invalid_shop_domain', diagId });
    return false;
  }

  return true;
}

export default async function handler(req, res) {
  const diagId = createDiagId();
  if (req.method === 'OPTIONS') {
    sendCorsOptions(req, res);
    return;
  }

  if ((req.method || '').toUpperCase() !== 'POST') {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Allow', 'POST, OPTIONS');
    }
    sendJsonWithCors(req, res, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  if (!SHOPIFY_ENABLED) {
    const payload = buildStubCheckoutPayload();
    sendJsonWithCors(req, res, 200, { ...payload, diagId });
    return;
  }

  if (!validateRealConfig(req, res, diagId)) {
    return;
  }

  try {
    req.mgmDiagId = diagId;
    await proxyRealHandler(req, res);
  } catch (err) {
    const step = err?.code === 'SHOPIFY_TIMEOUT' ? err?.step || 'shopify_request' : 'proxy_handler';
    logApiError('create-checkout', { diagId, step, error: err });
    if (!res.headersSent) {
      if (err?.code === 'SHOPIFY_TIMEOUT') {
        sendJsonWithCors(req, res, SHOPIFY_TIMEOUT_STATUS, {
          ok: false,
          error: 'shopify_timeout',
          diagId,
          step,
        });
        return;
      }
      sendJsonWithCors(req, res, 502, { ok: false, error: 'checkout_failed', diagId });
    }
  }
}

export const config = { memory: 256, maxDuration: 60 };
