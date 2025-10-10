import { applyCORS } from '../../lib/cors.js';
import { buildStubRequestId, resolveFrontOrigin } from '../../lib/_lib/stubHelpers.js';
import { runWithLenientCors, sendCorsOptions, sendJsonWithCors } from '../_lib/lenientCors.js';
import { createDiagId, logApiError } from '../_lib/diag.js';

const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';
const SHOPIFY_TIMEOUT_STATUS = 504;

function buildStubPrivatePayload() {
  const rid = buildStubRequestId();
  const origin = resolveFrontOrigin();
  const checkoutUrl = `${origin}/mockup?rid=${encodeURIComponent(rid)}&step=private&from=private-checkout`;

  return {
    ok: true,
    stub: true,
    url: checkoutUrl,
    checkoutUrl,
    invoiceUrl: checkoutUrl,
    draftOrderId: `mock_draft_${rid}`,
    requestIds: [],
  };
}

async function proxyRealHandler(req, res) {
  await runWithLenientCors(req, res, async () => {
    const mod = await import('../../api-routes/private/checkout/index.js');
    const handler = mod?.default || mod;
    if (typeof handler !== 'function') {
      throw new Error('handler_not_found');
    }
    return handler(req, res);
  });
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;
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
    const payload = buildStubPrivatePayload();
    sendJsonWithCors(req, res, 200, { ...payload, diagId });
    return;
  }

  try {
    req.mgmDiagId = diagId;
    await proxyRealHandler(req, res);
  } catch (err) {
    const step = err?.code === 'SHOPIFY_TIMEOUT' ? err?.step || 'shopify_request' : 'proxy_handler';
    logApiError('private-checkout', { diagId, step, error: err });
    if (!res.headersSent) {
      applyCORS(req, res);
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
