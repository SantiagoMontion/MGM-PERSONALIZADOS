import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import {
  resolveVariantIds,
  buildCartPermalink,
  precheckVariantAvailability,
  createStorefrontCart,
  normalizeCartAttributes,
  normalizeCartNote,
} from '../shopify/cartHelpers.js';
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
    email: z.union([z.string(), z.number()]).optional(),
    note: z.any().optional(),
    attributes: z.any().optional(),
    noteAttributes: z.any().optional(),
  })
  .passthrough();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

function collectAttributes(body) {
  if (Array.isArray(body?.noteAttributes) && body.noteAttributes.length) {
    return body.noteAttributes;
  }
  if (Array.isArray(body?.attributes) && body.attributes.length) {
    return body.attributes;
  }
  return [];
}

function buildNote(body) {
  const base = normalizeCartNote(body?.note);
  const emailRaw = body?.email;
  const email = emailRaw == null ? '' : String(emailRaw).trim();
  if (!email) return base;
  const emailLine = `Email cliente: ${email}`;
  if (!base) return emailLine.slice(0, 1000);
  if (base.includes(email)) return base;
  return `${base}\n${emailLine}`.slice(0, 1000);
}

function buildFallbackPayload({ variantNumericId, quantity, requestId, reason, userErrors }) {
  const fallbackUrl = buildCartPermalink(variantNumericId, quantity);
  if (!fallbackUrl) return null;
  return {
    ok: true,
    mode: 'permalink',
    url: fallbackUrl,
    webUrl: fallbackUrl,
    checkoutUrl: null,
    cartPlain: 'https://notmid.ar/cart',
    checkoutPlain: 'https://notmid.ar/checkout',
    strategy: 'permalink',
    requestId: requestId || undefined,
    fallbackReason: reason || undefined,
    ...(Array.isArray(userErrors) && userErrors.length ? { userErrors } : {}),
  };
}

/** Espera a que la variante exista en Storefront antes de armar el carrito (misma lógica que cart-link). */
const VARIANT_POLL_OPTIONS = { maxAttempts: 12, initialDelayMs: 2000 };

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

    const { variantId, variantGid, quantity } = parsed.data;
    let { variantNumericId, variantGid: resolvedVariantGid } = resolveVariantIds({ variantId, variantGid });

    if (!variantNumericId) {
      safeWarn('private_checkout_missing_variant', { variantId, variantGid });
      return sendJson(res, 400, { ok: false, reason: 'missing_variant' });
    }

    if (!resolvedVariantGid || !resolvedVariantGid.startsWith('gid://shopify/ProductVariant/')) {
      resolvedVariantGid = `gid://shopify/ProductVariant/${variantNumericId}`;
    }

    const qty = normalizeQuantity(quantity);
    const buyerIp = getClientIp(req);
    const note = buildNote(body);
    const normalizedAttributes = normalizeCartAttributes(collectAttributes(body));

    const poll = await precheckVariantAvailability(resolvedVariantGid, VARIANT_POLL_OPTIONS);

    if (!poll.ok || poll.available === false) {
      safeWarn('private_checkout_variant_poll_fallback', {
        variantNumericId,
        reason: poll.reason || 'variant_unavailable',
        attempts: poll.attempts || null,
        requestId: poll.requestId || null,
      });
      const fallback = buildFallbackPayload({
        variantNumericId,
        quantity: qty,
        requestId: poll.requestId || null,
        reason: poll.reason || 'variant_unavailable',
      });
      if (!fallback) {
        return sendJson(res, 400, { ok: false, reason: 'missing_variant' });
      }
      return sendJson(res, 200, {
        ...fallback,
        variantId: resolvedVariantGid,
        variantNumericId,
      });
    }

    let storefrontAttempt;
    try {
      storefrontAttempt = await createStorefrontCart({
        variantGid: resolvedVariantGid,
        quantity: qty,
        buyerIp,
        attributes: normalizedAttributes,
        note,
      });
    } catch (err) {
      safeWarn('private_checkout_storefront_exception', {
        variantNumericId,
        message: err?.message || String(err),
      });
      const fallback = buildFallbackPayload({
        variantNumericId,
        quantity: qty,
        requestId: poll.requestId || null,
        reason: 'storefront_exception',
      });
      if (!fallback) {
        return sendJson(res, 502, { ok: false, reason: 'shopify_unreachable' });
      }
      return sendJson(res, 200, {
        ...fallback,
        variantId: resolvedVariantGid,
        variantNumericId,
      });
    }

    if (storefrontAttempt.ok) {
      const primaryUrl = storefrontAttempt.checkoutUrl || storefrontAttempt.cartUrl;
      safeInfo('private_checkout_storefront_success', {
        variantNumericId,
        requestId: storefrontAttempt.requestId || poll.requestId || null,
        hasCheckoutUrl: Boolean(storefrontAttempt.checkoutUrl),
      });
      return sendJson(res, 200, {
        ok: true,
        mode: 'storefront',
        strategy: 'storefront',
        url: primaryUrl,
        webUrl: storefrontAttempt.cartUrl,
        checkoutUrl: storefrontAttempt.checkoutUrl || null,
        invoiceUrl: storefrontAttempt.checkoutUrl || null,
        cartPlain: storefrontAttempt.cartPlain || null,
        checkoutPlain: storefrontAttempt.checkoutPlain || null,
        cart_id: storefrontAttempt.cartId || null,
        cart_token: storefrontAttempt.cartToken || null,
        variantId: resolvedVariantGid,
        variantNumericId,
        requestId: storefrontAttempt.requestId || poll.requestId || undefined,
      });
    }

    safeWarn('private_checkout_storefront_failed', {
      variantNumericId,
      reason: storefrontAttempt.reason || 'storefront_failed',
      userErrors: storefrontAttempt.userErrors || null,
    });

    const fallback = buildFallbackPayload({
      variantNumericId,
      quantity: qty,
      requestId: storefrontAttempt.requestId || poll.requestId || null,
      reason: storefrontAttempt.reason || 'storefront_failed',
      userErrors: storefrontAttempt.userErrors,
    });
    if (!fallback) {
      return sendJson(res, 400, { ok: false, reason: 'missing_variant' });
    }
    return sendJson(res, 200, {
      ...fallback,
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
