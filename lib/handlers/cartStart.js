import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import {
  createStorefrontCartServer,
  fallbackCartAdd,
  SimpleCookieJar,
  waitForVariantAvailability,
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

function hasVariantInvalidUserError(result) {
  if (!result || result.reason !== 'user_errors') return false;
  if (!Array.isArray(result.userErrors)) return false;
  return result.userErrors.some((err) => {
    if (!err || typeof err !== 'object') return false;
    const message = typeof err.message === 'string' ? err.message : '';
    const code = typeof err.code === 'string' ? err.code : '';
    if (code && code.toUpperCase() === 'INVALID') return true;
    if (message && /does not exist/i.test(message)) return true;
    if (message && /no existe/i.test(message)) return true;
    return false;
  });
}

async function attemptStorefrontCreate({
  variantGid,
  quantity,
  buyerIp,
  attempts = 2,
  availabilityPrecheck = null,
}) {
  let lastError = null;
  let availabilityChecked = Boolean(availabilityPrecheck?.ok);
  let availabilitySummary = availabilityPrecheck?.availability || null;
  let availabilityRequestId = availabilityPrecheck?.requestId || null;
  const variantNumericId = variantGid.split('/').pop();
  for (let i = 0; i < attempts; i += 1) {
    const attemptNumber = i + 1;
    try {
      console.info('cart_start_storefront_attempt', {
        attempt: attemptNumber,
        variantGid,
        variantNumericId,
        quantity,
        prechecked: availabilityChecked,
      });
    } catch {}
    const result = await createStorefrontCartServer({ variantGid, quantity, buyerIp });
    if (result.ok) {
      return {
        ...result,
        attempts: attemptNumber,
        availability: availabilitySummary || undefined,
        availabilityRequestId: availabilityRequestId || undefined,
      };
    }
    lastError = {
      ...result,
      attempts: attemptNumber,
      availability: availabilitySummary || undefined,
      availabilityRequestId: availabilityRequestId || undefined,
    };
    if (!availabilityChecked && hasVariantInvalidUserError(result)) {
      availabilityChecked = true;
      const availability = await waitForVariantAvailability({
        variantGid,
        buyerIp,
        attempts: 10,
        backoffMs: [2000, 3000, 4500, 6500, 9000, 13000, 18000, 26000, 36000, 48000],
        initialDelayMs: 500,
        productHandle: availabilitySummary?.productHandle,
        productOnlineStoreUrl: availabilitySummary?.productOnlineStoreUrl,
      });
      availabilitySummary = availability?.availability || availabilitySummary;
      if (availability?.requestId) {
        availabilityRequestId = availability.requestId;
      }
      if (availability?.ok) {
        try {
          console.info('cart_start_variant_ready_after_retry', {
            attempts: availability.attempts,
            requestId: availability.requestId || null,
            productHandle: availability?.availability?.productHandle || null,
            variantGid,
            variantNumericId,
          });
        } catch {}
      }
      if (!availability.ok) {
        return {
          ok: false,
          reason: availability.reason || 'variant_not_ready',
          availability,
          userErrors: result.userErrors,
          requestId: result.requestId,
          attempts: attemptNumber,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
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

  try {
    console.info('cart_start_variant_check_begin', {
      variantGid,
      variantNumericId,
      quantity: normalizedQuantity,
    });
  } catch {}

  const availabilityBackoff = [1500, 2500, 4000, 6000, 9000, 13000, 20000, 30000, 45000, 60000];
  let availabilityPrecheck = null;
  try {
    availabilityPrecheck = await waitForVariantAvailability({
      variantGid,
      buyerIp,
      attempts: availabilityBackoff.length + 1,
      backoffMs: availabilityBackoff,
    });
  } catch (pollErr) {
    availabilityPrecheck = null;
    try {
      console.error('cart_start_variant_poll_error', pollErr);
    } catch {}
  }

  let variantReady = Boolean(availabilityPrecheck?.ok);
  let availabilitySummary = availabilityPrecheck?.availability || null;
  let availabilityRequestId = availabilityPrecheck?.requestId || null;
  const availabilityReason = availabilityPrecheck?.reason || null;
  const availabilityAttempts = availabilityPrecheck?.attempts || null;

  const availabilityLastErrorMessage =
    typeof availabilityPrecheck?.lastError?.body === 'string' && availabilityPrecheck.lastError.body
      ? availabilityPrecheck.lastError.body.slice(0, 200)
      : typeof availabilityPrecheck?.lastError?.reason === 'string'
        ? availabilityPrecheck.lastError.reason
        : null;

  if (availabilityPrecheck?.ok) {
    try {
      console.info('cart_start_variant_ready', {
        attempts: availabilityAttempts,
        requestId: availabilityRequestId || null,
        productHandle: availabilitySummary?.productHandle || null,
        productUrl: availabilitySummary?.productOnlineStoreUrl || null,
        variantGid,
        variantNumericId,
      });
    } catch {}
  } else if (availabilityPrecheck) {
    try {
      console.warn('cart_start_variant_pending', {
        reason: availabilityReason || 'variant_not_ready',
        attempts: availabilityAttempts,
        requestId: availabilityRequestId || null,
        productHandle: availabilitySummary?.productHandle || null,
        variantGid,
        variantNumericId,
        lastErrorMessage: availabilityLastErrorMessage,
      });
    } catch {}
  }

  const publicPermalink = buildCartPermalink(variantNumericId, normalizedQuantity)
    || `${CART_ORIGIN}/cart`;

  if (!variantReady) {
    try {
      console.info('permalink_fallback_used', {
        variantGid,
        variantNumericId,
        requestId: availabilityRequestId || null,
        reason: availabilityReason || 'variant_not_ready',
        availabilityAttempts,
        lastErrorMessage: availabilityLastErrorMessage,
        url: publicPermalink,
      });
    } catch {}
    return respond(res, 200, {
      ok: true,
      url: publicPermalink,
      cartUrl: publicPermalink,
      cartWebUrl: publicPermalink,
      cartPlain: `${CART_ORIGIN}/cart`,
      usedFallback: true,
      fallbackMode: 'permalink',
      fallbackPlainUrl: publicPermalink,
      requestId: availabilityRequestId || undefined,
      storefrontCartUrl: undefined,
      publicCartUrl: publicPermalink,
      availability: availabilitySummary || undefined,
      variantReady: false,
    });
  }

  const storefrontResult = await attemptStorefrontCreate({
    variantGid,
    quantity: normalizedQuantity,
    buyerIp,
    attempts: variantReady ? 2 : 3,
    availabilityPrecheck,
  });

  if (storefrontResult?.ok) {
    const storefrontCartUrl = typeof storefrontResult.cartUrl === 'string'
      ? storefrontResult.cartUrl.trim()
      : '';
    const checkoutUrl = typeof storefrontResult.checkoutUrl === 'string'
      ? storefrontResult.checkoutUrl.trim()
      : '';
    if (!variantReady) {
      variantReady = true;
    }
    if (!availabilitySummary && storefrontResult.availability) {
      availabilitySummary = storefrontResult.availability;
    }
    if (!availabilityRequestId && storefrontResult.availabilityRequestId) {
      availabilityRequestId = storefrontResult.availabilityRequestId;
    }
    const finalUrl = variantReady ? publicPermalink : storefrontCartUrl || publicPermalink;
    try {
      console.info('cart_start_return_storefront', {
        url: finalUrl,
        storefrontCartUrl,
        checkoutUrl,
        publicCartUrl: publicPermalink || null,
        variantReady,
        requestId: storefrontResult.requestId || availabilityRequestId || null,
      });
    } catch {}
    return respond(res, 200, {
      ok: true,
      url: finalUrl,
      cartId: storefrontResult.cartId || undefined,
      cartUrl: finalUrl || undefined,
      cartPlain: storefrontResult.cartPlain || `${CART_ORIGIN}/cart`,
      cartToken: storefrontResult.cartToken || undefined,
      cartWebUrl: finalUrl || undefined,
      checkoutUrl: checkoutUrl || undefined,
      checkoutPlain: storefrontResult.checkoutPlain || undefined,
      usedFallback: false,
      requestId: storefrontResult.requestId || availabilityRequestId || undefined,
      storefrontCartUrl: storefrontCartUrl || undefined,
      publicCartUrl: publicPermalink || undefined,
      availability: availabilitySummary || undefined,
      variantReady: true,
    });
  }

  if (!availabilitySummary && storefrontResult?.availability) {
    availabilitySummary = storefrontResult.availability;
  }
  if (!availabilityRequestId && storefrontResult?.availabilityRequestId) {
    availabilityRequestId = storefrontResult.availabilityRequestId;
  }

  const storefrontLastErrorMessage = typeof storefrontResult?.detail === 'string' && storefrontResult.detail
    ? storefrontResult.detail.slice(0, 200)
    : typeof storefrontResult?.body === 'string' && storefrontResult.body
      ? storefrontResult.body.slice(0, 200)
      : Array.isArray(storefrontResult?.errors) && storefrontResult.errors.length
        ? String(storefrontResult.errors[0]?.message || '') || undefined
        : Array.isArray(storefrontResult?.userErrors) && storefrontResult.userErrors.length
          ? String(storefrontResult.userErrors[0]?.message || '') || undefined
          : undefined;
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
      requestId: storefrontResult?.requestId || availabilityRequestId || undefined,
      variantGid,
      variantNumericId,
      attempts: storefrontResult?.attempts || null,
      lastErrorMessage: storefrontLastErrorMessage || null,
    });
  } catch {}

  const jar = new SimpleCookieJar();
  const fallbackResult = await fallbackCartAdd({
    variantNumericId,
    quantity: normalizedQuantity,
    jar,
  });
  if (fallbackResult.ok) {
    if (!variantReady) {
      try {
        console.info('cart_start_variant_verify_after_fallback', {
          variantGid,
          variantNumericId,
        });
      } catch {}
    }
    if (!variantReady) {
      let fallbackAvailability = null;
      try {
        fallbackAvailability = await waitForVariantAvailability({
          variantGid,
          buyerIp,
          attempts: 6,
          backoffMs: [2000, 3000, 4500, 6500, 9000, 13000],
          productHandle: availabilitySummary?.productHandle,
          productOnlineStoreUrl: availabilitySummary?.productOnlineStoreUrl,
        });
      } catch (fallbackPollErr) {
        try {
          console.error('cart_start_variant_verify_error', fallbackPollErr);
        } catch {}
      }
      if (fallbackAvailability?.ok) {
        variantReady = true;
        availabilitySummary = fallbackAvailability.availability || availabilitySummary;
        if (!availabilityRequestId && fallbackAvailability.requestId) {
          availabilityRequestId = fallbackAvailability.requestId;
        }
        try {
          console.info('cart_start_variant_ready_after_fallback', {
            attempts: fallbackAvailability.attempts,
            requestId: fallbackAvailability.requestId || null,
            productHandle: fallbackAvailability?.availability?.productHandle || null,
            variantGid,
            variantNumericId,
          });
        } catch {}
      } else if (fallbackAvailability) {
        try {
          console.warn('cart_start_variant_still_pending', {
            reason: fallbackAvailability?.reason || 'variant_not_ready',
            attempts: fallbackAvailability?.attempts || null,
            requestId: fallbackAvailability?.requestId || null,
            variantGid,
            variantNumericId,
          });
        } catch {}
      }
    }
    const fallbackCartUrl = typeof fallbackResult.cartUrl === 'string'
      ? fallbackResult.cartUrl.trim()
      : '';
    const fallbackPlainUrl = typeof fallbackResult.fallbackCartUrl === 'string'
      ? fallbackResult.fallbackCartUrl.trim()
      : '';
    const finalUrl = variantReady
      ? publicPermalink
      : fallbackCartUrl || fallbackPlainUrl || publicPermalink;
    try {
      console.info('cart_start_return_fallback', {
        url: finalUrl,
        fallbackCartUrl,
        fallbackPlainUrl,
        publicCartUrl: publicPermalink || null,
        variantReady,
        requestId: storefrontResult?.requestId || availabilityRequestId || null,
        detailPreview: typeof fallbackResult?.detail === 'string'
          ? fallbackResult.detail.slice(0, 200)
          : undefined,
        variantGid,
        variantNumericId,
      });
    } catch {}
    return respond(res, 200, {
      ok: true,
      url: finalUrl,
      cartUrl: finalUrl || undefined,
      cartWebUrl: finalUrl || undefined,
      cartPlain: fallbackPlainUrl || `${CART_ORIGIN}/cart`,
      fallbackUrl: fallbackCartUrl || undefined,
      fallbackPlainUrl: fallbackPlainUrl || undefined,
      usedFallback: true,
      requestId: storefrontResult?.requestId || availabilityRequestId || undefined,
      storefrontCartUrl: fallbackCartUrl || undefined,
      publicCartUrl: publicPermalink || undefined,
      availability: availabilitySummary || undefined,
      variantReady: Boolean(variantReady),
      storefrontUserErrors: Array.isArray(storefrontResult?.userErrors) && storefrontResult.userErrors.length
        ? storefrontResult.userErrors
        : undefined,
    });
  }

  const finalReason = fallbackResult.reason || storefrontResult?.reason || 'cart_start_failed';
  const fallbackLastErrorMessage = typeof fallbackResult?.detail === 'string' && fallbackResult.detail
    ? fallbackResult.detail.slice(0, 200)
    : typeof fallbackResult?.reason === 'string'
      ? fallbackResult.reason
      : null;
  try {
    console.error('cart_start_failure', {
      variantGid,
      variantNumericId,
      quantity: normalizedQuantity,
      storefrontResult,
      fallbackResult,
      availability: availabilitySummary || undefined,
      requestId: storefrontResult?.requestId || availabilityRequestId || undefined,
      finalReason,
    });
  } catch {}

  try {
    console.info('permalink_fallback_used', {
      variantGid,
      variantNumericId,
      requestId: storefrontResult?.requestId || availabilityRequestId || null,
      reason: finalReason,
      availabilityAttempts: availabilityAttempts || null,
      lastErrorMessage: fallbackLastErrorMessage || storefrontLastErrorMessage || null,
      url: publicPermalink,
    });
  } catch {}

  return respond(res, 200, {
    ok: true,
    url: publicPermalink,
    cartUrl: publicPermalink,
    cartWebUrl: publicPermalink,
    cartPlain: `${CART_ORIGIN}/cart`,
    fallbackPlainUrl: publicPermalink,
    usedFallback: true,
    fallbackMode: 'permalink',
    requestId: storefrontResult?.requestId || availabilityRequestId || undefined,
    storefrontCartUrl: undefined,
    publicCartUrl: publicPermalink,
    availability: availabilitySummary || undefined,
    variantReady: Boolean(variantReady),
    storefrontUserErrors: Array.isArray(storefrontResult?.userErrors) && storefrontResult.userErrors.length
      ? storefrontResult.userErrors
      : undefined,
    fallbackError: fallbackResult.reason || undefined,
    storefrontError: storefrontResult?.reason || undefined,
  });
}
