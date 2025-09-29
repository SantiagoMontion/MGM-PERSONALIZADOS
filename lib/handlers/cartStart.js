import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import { createStorefrontCartServer } from '../shopify/storefrontCartServer.js';

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
  const permalink = buildCartPermalink(variantNumericId, normalizedQuantity);

  let finalUrl = permalink;
  let strategy = 'permalink';
  let requestId = null;
  let storefrontReason = null;
  let userErrors = null;

  try {
    const result = await createStorefrontCartServer({ variantGid, quantity: normalizedQuantity, buyerIp });
    if (result.ok) {
      const cartUrl = result.cartUrl || result.cartWebUrl || '';
      const checkoutUrl = result.checkoutUrl || '';
      if (cartUrl) {
        finalUrl = cartUrl;
        strategy = 'storefront_cart';
      } else if (checkoutUrl) {
        finalUrl = checkoutUrl;
        strategy = 'storefront_checkout';
      }
      requestId = result.requestId || null;
    } else {
      requestId = result?.requestId || null;
      storefrontReason = result?.reason || null;
      if (Array.isArray(result?.userErrors) && result.userErrors.length) {
        userErrors = result.userErrors;
        try {
          console.warn('cart_start_user_errors', {
            requestId: requestId || null,
            userErrors,
          });
        } catch {}
      }
    }
  } catch (err) {
    storefrontReason = 'exception';
    try {
      console.error('cart_start_storefront_exception', { message: err?.message || String(err) });
    } catch {}
  }

  if (!finalUrl) {
    finalUrl = permalink || CART_ORIGIN;
    strategy = 'permalink';
  }

  const responsePayload = {
    ok: true,
    url: finalUrl,
    strategy,
    ...(requestId ? { requestId } : {}),
    ...(storefrontReason ? { storefrontReason } : {}),
    ...(userErrors ? { userErrors } : {}),
  };

  try {
    console.info('cart_start_result', {
      ...responsePayload,
      variantGid,
      variantNumericId,
    });
  } catch {}

  return respond(res, 200, responsePayload, 'cart_start_success');
}
