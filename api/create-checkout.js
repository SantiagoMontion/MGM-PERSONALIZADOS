import { buildStubRequestId, resolveFrontOrigin } from '../lib/_lib/stubHelpers.js';
import { runWithLenientCors, sendCorsOptions, sendJsonWithCors } from './_lib/lenientCors.js';

const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendCorsOptions(req, res);
    return;
  }

  if ((req.method || '').toUpperCase() !== 'POST') {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Allow', 'POST, OPTIONS');
    }
    sendJsonWithCors(req, res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  if (!SHOPIFY_ENABLED) {
    const payload = buildStubCheckoutPayload();
    sendJsonWithCors(req, res, 200, payload);
    return;
  }

  try {
    await proxyRealHandler(req, res);
  } catch (err) {
    if (!res.headersSent) {
      sendJsonWithCors(req, res, 500, { ok: false, error: 'internal_error' });
    }
  }
}

export const config = { memory: 256 };
