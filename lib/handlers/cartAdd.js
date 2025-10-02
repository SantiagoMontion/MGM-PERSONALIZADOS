import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import {
  addLinesToStorefrontCart,
  fallbackCartAdd,
  SimpleCookieJar,
} from '../shopify/storefrontCartServer.js';

const BodySchema = z
  .object({
    cartId: z.string(),
    variantGid: z.string(),
    quantity: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.floor(raw));
}

function respond(res, status, payload, logLabel = '[cart_add_response]') {
  const body = JSON.stringify(payload ?? {});
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  const contentType = 'application/json; charset=utf-8';
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', contentType);
  }
  if (typeof res.send === 'function') {
    res.send(body);
  } else {
    res.end(body);
  }
  try {
    console.info(logLabel, { status, contentType });
  } catch (loggingErr) {
    if (loggingErr) {
      // noop
    }
  }
}

async function attemptStorefrontAdd({ cartId, variantGid, quantity, buyerIp, attempts = 2 }) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    const result = await addLinesToStorefrontCart({ cartId, variantGid, quantity, buyerIp });
    if (result.ok) {
      return result;
    }
    lastError = result;
    if (result.reason === 'user_errors' || result.reason === 'http_error' || result.reason === 'graphql_errors') {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    break;
  }
  return lastError || { ok: false, reason: 'storefront_failed' };
}

export default async function cartAdd(req, res) {
  try {
    console.info('[cart_add_request]', { method: req.method, path: req.url || '' });
  } catch (loggingErr) {
    if (loggingErr) {
      // noop
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    const status = err?.code === 'payload_too_large' ? 413 : err?.code === 'invalid_json' ? 400 : 400;
    return respond(res, status, { ok: false, error: err?.code || 'invalid_body' });
  }
  const parsed = BodySchema.safeParse(body || {});
  if (!parsed.success) {
    return respond(res, 400, { ok: false, error: 'invalid_body' });
  }
  const { cartId, variantGid, quantity } = parsed.data;
  if (!variantGid.startsWith('gid://shopify/ProductVariant/')) {
    return respond(res, 400, { ok: false, error: 'invalid_variant_gid' });
  }
  const normalizedQuantity = normalizeQuantity(quantity ?? 1);
  const buyerIp = getClientIp(req);
  const storefrontResult = await attemptStorefrontAdd({
    cartId,
    variantGid,
    quantity: normalizedQuantity,
    buyerIp,
  });
  if (storefrontResult?.ok) {
    const storefrontCartUrl = typeof storefrontResult.cartUrl === 'string'
      ? storefrontResult.cartUrl.trim()
      : '';
    const checkoutUrl = typeof storefrontResult.checkoutUrl === 'string'
      ? storefrontResult.checkoutUrl.trim()
      : '';
    return respond(res, 200, {
      ok: true,
      url: storefrontCartUrl || undefined,
      cartId: storefrontResult.cartId || undefined,
      cartUrl: storefrontCartUrl || undefined,
      cartPlain: storefrontResult.cartPlain || undefined,
      cartToken: storefrontResult.cartToken || undefined,
      cartWebUrl: storefrontCartUrl || undefined,
      checkoutUrl: checkoutUrl || undefined,
      checkoutPlain: storefrontResult.checkoutPlain || undefined,
      usedFallback: false,
      requestId: storefrontResult.requestId || undefined,
    });
  }
  const variantId = variantGid.split('/').pop();
  const jar = new SimpleCookieJar();
  const fallbackResult = await fallbackCartAdd({
    variantNumericId: variantId,
    quantity: normalizedQuantity,
    jar,
  });
  if (fallbackResult.ok) {
    const fallbackCartUrl = typeof fallbackResult.cartUrl === 'string'
      ? fallbackResult.cartUrl.trim()
      : '';
    const fallbackPlainUrl = typeof fallbackResult.fallbackCartUrl === 'string'
      ? fallbackResult.fallbackCartUrl.trim()
      : '';
    const finalUrl = fallbackPlainUrl || fallbackCartUrl || undefined;
    console.info('[cart_add_return_fallback]', {
      url: finalUrl,
      fallbackCartUrl,
      fallbackPlainUrl,
    });
    return respond(res, 200, {
      ok: true,
      url: finalUrl,
      cartUrl: finalUrl || undefined,
      cartWebUrl: finalUrl || undefined,
      cartPlain: fallbackPlainUrl || undefined,
      fallbackUrl: fallbackCartUrl || undefined,
      fallback: true,
      usedFallback: true,
      requestId: storefrontResult?.requestId || undefined,
    });
  }
  return respond(res, 502, {
    ok: false,
    reason: fallbackResult.reason || storefrontResult?.reason || 'cart_add_failed',
    detail: fallbackResult.detail || storefrontResult?.detail || null,
    userErrors: storefrontResult?.userErrors || undefined,
    requestId: storefrontResult?.requestId || undefined,
  });
}
