import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import {
  createStorefrontCartServer,
  fallbackCartAdd,
  SimpleCookieJar,
} from '../shopify/storefrontCartServer.js';

const BodySchema = z
  .object({
    variantGid: z.string(),
    quantity: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.floor(raw));
}

const CART_ORIGIN = (process.env.SHOPIFY_CART_ORIGIN || 'https://www.mgmgamers.store').replace(/\/+$/, '');

function buildCartPermalink(variantNumericId, quantity) {
  const id = variantNumericId ? String(variantNumericId).trim() : '';
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.max(1, Math.floor(quantity)) : 1;
  if (!id) return '';
  return `${CART_ORIGIN}/cart/${id}:${qty}`;
}

function respond(res, status, payload, logLabel = 'cart_start_response') {
  const body = payload ?? {};
  const contentType = 'application/json; charset=utf-8';
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', contentType);
  }
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  if (typeof res.json === 'function') {
    res.json(body);
  } else if (typeof res.send === 'function') {
    res.send(JSON.stringify(body));
  } else {
    res.end(JSON.stringify(body));
  }
  try {
    console.info(logLabel, { status, contentType, body });
  } catch {}
}

async function attemptStorefrontCreate({ variantGid, quantity, buyerIp, attempts = 2 }) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    const result = await createStorefrontCartServer({ variantGid, quantity, buyerIp });
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

export default async function cartStart(req, res) {
  try {
    console.info('cart_start_request', { method: req.method, path: req.url || '' });
  } catch {}

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

  const { variantGid, quantity } = parsed.data;
  if (!variantGid.startsWith('gid://shopify/ProductVariant/')) {
    return respond(res, 400, { ok: false, error: 'invalid_variant_gid' });
  }

  const normalizedQuantity = normalizeQuantity(quantity ?? 1);
  const buyerIp = getClientIp(req);
  const variantNumericId = variantGid.split('/').pop();

  const storefrontResult = await attemptStorefrontCreate({
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
    const finalUrl = storefrontCartUrl || buildCartPermalink(variantNumericId, normalizedQuantity);
    console.info('cart_start_return_storefront', { url: finalUrl, storefrontCartUrl, checkoutUrl });
    return respond(res, 200, {
      ok: true,
      url: finalUrl,
      cartId: storefrontResult.cartId || undefined,
      cartUrl: storefrontCartUrl || undefined,
      cartPlain: storefrontResult.cartPlain || undefined,
      cartToken: storefrontResult.cartToken || undefined,
      cartWebUrl: finalUrl || undefined,
      checkoutUrl: checkoutUrl || undefined,
      checkoutPlain: storefrontResult.checkoutPlain || undefined,
      usedFallback: false,
      requestId: storefrontResult.requestId || undefined,
    });
  }

  try {
    console.warn('cart_start_storefront_failed', {
      reason: storefrontResult?.reason || 'storefront_failed',
      status: typeof storefrontResult?.status === 'number' ? storefrontResult.status : undefined,
      userErrors: Array.isArray(storefrontResult?.userErrors) && storefrontResult.userErrors.length
        ? storefrontResult.userErrors
        : undefined,
      errors: Array.isArray(storefrontResult?.errors) && storefrontResult.errors.length
        ? storefrontResult.errors
        : undefined,
      detail: typeof storefrontResult?.body === 'string' && storefrontResult.body
        ? storefrontResult.body
        : typeof storefrontResult?.detail === 'string' && storefrontResult.detail
          ? storefrontResult.detail
          : undefined,
      requestId: storefrontResult?.requestId || undefined,
    });
  } catch {}

  const jar = new SimpleCookieJar();
  const fallbackResult = await fallbackCartAdd({
    variantNumericId,
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
    const finalUrl = fallbackCartUrl
      || fallbackPlainUrl
      || buildCartPermalink(variantNumericId, normalizedQuantity);
    console.info('cart_start_return_fallback', {
      url: finalUrl,
      fallbackCartUrl,
      fallbackPlainUrl,
      detailPreview: typeof fallbackResult?.detail === 'string'
        ? fallbackResult.detail.slice(0, 200)
        : undefined,
    });
    return respond(res, 200, {
      ok: true,
      url: finalUrl,
      cartUrl: fallbackCartUrl || finalUrl || undefined,
      cartWebUrl: finalUrl || undefined,
      cartPlain: fallbackPlainUrl || undefined,
      fallbackUrl: fallbackCartUrl || undefined,
      fallbackPlainUrl: fallbackPlainUrl || undefined,
      usedFallback: true,
      requestId: storefrontResult?.requestId || undefined,
      storefrontUserErrors: Array.isArray(storefrontResult?.userErrors) && storefrontResult.userErrors.length
        ? storefrontResult.userErrors
        : undefined,
    });
  }

  console.error('cart_start_failure', {
    variantGid,
    quantity: normalizedQuantity,
    storefrontResult,
    fallbackResult,
  });

  return respond(res, 502, {
    ok: false,
    reason: fallbackResult.reason || storefrontResult?.reason || 'cart_start_failed',
    detail: fallbackResult.detail || storefrontResult?.detail || null,
    userErrors: storefrontResult?.userErrors || undefined,
    requestId: storefrontResult?.requestId || undefined,
  });
}
