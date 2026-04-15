import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { resolveVariantIds, buildCartPermalink } from '../shopify/cartHelpers.js';
import logger from '../_lib/logger.js';
import { applyStubCors, buildStubRequestId, handleStubOptions, isStubEnabled, resolveFrontOrigin } from '../_lib/stubHelpers.js';

function safeLog(level, label, payload) {
  try {
    const logFn = typeof logger?.[level] === 'function' ? logger[level] : logger.debug;
    logFn(label, payload);
  } catch {}
}

function safeInfo(label, payload) {
  safeLog('debug', label, payload);
}

function safeWarn(label, payload) {
  safeLog('warn', label, payload);
}

function safeError(label, payload) {
  safeLog('error', label, payload);
}

function sendJson(res, status, body) {
  const contentType = 'application/json; charset=utf-8';
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', contentType);
  }
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  safeInfo('private_checkout_response', {
    status,
    contentType: typeof res.getHeader === 'function' ? res.getHeader('Content-Type') || contentType : contentType,
  });
  const payload = body ?? {};
  if (typeof res.json === 'function') {
    res.json(payload);
  } else if (typeof res.send === 'function') {
    res.send(JSON.stringify(payload));
  } else {
    res.end(JSON.stringify(payload));
  }
}

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    discount: z.union([z.string(), z.number()]).optional(),
    discountCode: z.union([z.string(), z.number()]).optional(),
    productId: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

export default async function privateCheckout(req, res) {
  safeInfo('private_checkout_incoming', {
    method: req.method,
    path: req.url || '',
  });

  if (handleStubOptions(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Allow', 'POST');
    }
    return sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
  }

  if (isStubEnabled()) {
    applyStubCors(res);
    const rid = buildStubRequestId();
    const origin = resolveFrontOrigin();
    const checkoutUrl = `${origin}/mockup?rid=${rid}&step=private&from=private-checkout`;
    return sendJson(res, 200, {
      ok: true,
      stub: true,
      url: checkoutUrl,
      checkoutUrl,
      invoiceUrl: checkoutUrl,
      draftOrderId: `mock_draft_${rid}`,
      requestIds: [],
    });
  }

  try {
    const body = await parseJsonBody(req).catch((err) => {
      if (err?.code === 'payload_too_large') {
        res.statusCode = 413;
        throw err;
      }
      if (err?.code === 'invalid_json') {
        res.statusCode = 400;
        throw err;
      }
      throw err;
    });

    const parsed = BodySchema.safeParse(body || {});
    if (!parsed.success) {
      safeWarn('private_checkout_body_invalid', { issues: parsed.error?.issues || null });
      return sendJson(res, 400, { ok: false, reason: 'bad_request' });
    }

    const { variantId, variantGid, quantity, productId } = parsed.data;
    let { variantNumericId, variantGid: resolvedVariantGid } = resolveVariantIds({ variantId, variantGid });

    if (!variantNumericId) {
      safeWarn('private_checkout_missing_variant', { variantId, variantGid });
      return sendJson(res, 400, { ok: false, reason: 'missing_variant' });
    }

    if (!resolvedVariantGid || !resolvedVariantGid.startsWith('gid://shopify/ProductVariant/')) {
      resolvedVariantGid = `gid://shopify/ProductVariant/${variantNumericId}`;
    }

    const qty = normalizeQuantity(quantity);
    const basePermalink = buildCartPermalink(variantNumericId, qty);

    if (!basePermalink) {
      safeWarn('private_checkout_permalink_missing', { variantNumericId, quantity: qty });
      return sendJson(res, 400, { ok: false, reason: 'missing_variant' });
    }

    return sendJson(res, 200, {
      ok: true,
      mode: 'permalink',
      url: basePermalink,
      variantId: resolvedVariantGid,
      variantNumericId,
    });
  } catch (err) {
    if (res.statusCode === 413) {
      return sendJson(res, 413, { ok: false, reason: 'payload_too_large' });
    }
    if (res.statusCode === 400 && err?.code === 'invalid_json') {
      return sendJson(res, 400, { ok: false, reason: 'bad_request' });
    }
    safeError('private_checkout_unhandled_error', {
      message: typeof err?.message === 'string' ? err.message : undefined,
      stack: err?.stack,
    });
    return sendJson(res, 500, { ok: false, reason: 'internal_error' });
  }
}
