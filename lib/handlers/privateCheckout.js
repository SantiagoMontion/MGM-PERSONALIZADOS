import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import {
  resolveVariantIds,
  normalizeCartAttributes,
  normalizeCartNote,
} from '../shopify/cartHelpers.js';
import { shopifyStorefrontGraphQL } from '../shopify.js';

function safeLog(method, label, payload) {
  try {
    const logger = typeof console?.[method] === 'function' ? console[method] : console.info;
    logger(label, payload);
  } catch {}
}

function safeInfo(label, payload) {
  safeLog('info', label, payload);
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
  const payload = body ?? {};
  if (typeof res.json === 'function') {
    res.json(payload);
  } else if (typeof res.send === 'function') {
    res.send(JSON.stringify(payload));
  } else {
    res.end(JSON.stringify(payload));
  }
}

const LineInputSchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    lines: z.array(LineInputSchema).optional(),
    email: z.string().email().optional(),
    note: z.any().optional(),
    attributes: z.any().optional(),
    noteAttributes: z.any().optional(),
    discountCode: z.string().optional(),
    discount: z.string().optional(),
    productHandle: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

const CHECKOUT_CREATE_MUTATION = `
  mutation PrivateCheckoutCreate($input: CheckoutCreateInput!) {
    checkoutCreate(input: $input) {
      checkout {
        id
        webUrl
      }
      checkoutUserErrors {
        message
        code
        field
      }
    }
  }
`;

function readRequestId(resp) {
  if (!resp || typeof resp.headers?.get !== 'function') return '';
  return (
    resp.headers.get('x-request-id') ||
    resp.headers.get('x-requestid') ||
    resp.headers.get('X-Request-ID') ||
    resp.headers.get('X-RequestId') ||
    ''
  );
}

function parseJsonMaybe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeLineInput(entry, fallbackQuantity) {
  if (!entry || typeof entry !== 'object') return null;
  const { variantId, variantGid, quantity } = entry;
  const resolved = resolveVariantIds({ variantId, variantGid });
  const variantNumericId = resolved.variantNumericId;
  const ensuredGid = resolved.variantGid;
  if (!variantNumericId && !ensuredGid) return null;
  const qty = normalizeQuantity(quantity ?? fallbackQuantity ?? 1);
  return {
    variantNumericId,
    variantGid: ensuredGid || (variantNumericId ? `gid://shopify/ProductVariant/${variantNumericId}` : ''),
    quantity: qty,
  };
}

function buildLinesFromBody(data) {
  const normalized = [];
  const candidateLines = Array.isArray(data.lines) ? data.lines : [];
  for (const entry of candidateLines) {
    const line = normalizeLineInput(entry, data.quantity);
    if (line && line.variantGid) {
      normalized.push(line);
    }
    if (normalized.length >= 99) break;
  }
  if (!normalized.length) {
    const fallback = normalizeLineInput(
      { variantId: data.variantId, variantGid: data.variantGid, quantity: data.quantity },
      data.quantity,
    );
    if (fallback && fallback.variantGid) {
      normalized.push(fallback);
    }
  }
  return normalized;
}

function interpretUserErrors(rawErrors) {
  if (!Array.isArray(rawErrors)) return { userErrors: [], reason: 'storefront_user_errors' };
  const userErrors = rawErrors
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const message = typeof entry.message === 'string' ? entry.message.trim() : '';
      const codeRaw = typeof entry.code === 'string' ? entry.code : '';
      const field = Array.isArray(entry.field)
        ? entry.field.map((value) => (value == null ? '' : String(value))).filter(Boolean)
        : undefined;
      if (!message && !codeRaw) return null;
      return {
        ...(message ? { message } : {}),
        ...(codeRaw ? { code: codeRaw } : {}),
        ...(field && field.length ? { field } : {}),
      };
    })
    .filter(Boolean);
  if (!userErrors.length) return { userErrors: [], reason: 'storefront_user_errors' };

  const normalizedCodes = userErrors
    .map((err) => (typeof err.code === 'string' ? err.code.toUpperCase() : ''))
    .filter(Boolean);
  const normalizedMessages = userErrors
    .map((err) => (typeof err.message === 'string' ? err.message.toLowerCase() : ''))
    .filter(Boolean);

  if (normalizedCodes.some((code) => code.includes('DISCOUNT')) || normalizedMessages.some((msg) => msg.includes('discount'))) {
    return {
      userErrors,
      reason: 'discount_code_invalid',
      friendlyMessage:
        'El código de descuento no es válido. Podés continuar sin cupón o probar con otro.',
    };
  }

  if (
    normalizedCodes.some((code) => code.includes('UNAVAILABLE') || code.includes('NOT_AVAILABLE')) ||
    normalizedMessages.some(
      (msg) =>
        msg.includes('no está disponible') ||
        msg.includes('not available') ||
        msg.includes('unavailable') ||
        msg.includes('cannot be purchased'),
    )
  ) {
    return {
      userErrors,
      reason: 'product_not_published_storefront',
      friendlyMessage: 'Producto no publicado en canal Storefront.',
    };
  }

  return {
    userErrors,
    reason: 'storefront_user_errors',
    friendlyMessage: 'No pudimos generar el checkout privado. Probá de nuevo en unos segundos.',
  };
}

async function createStorefrontCheckout({ lines, email, note, attributes, discountCode, buyerIp }) {
  if (!Array.isArray(lines) || !lines.length) {
    return { ok: false, reason: 'missing_lines' };
  }
  const lineItems = lines
    .map((line) => {
      if (!line?.variantGid) return null;
      return {
        variantId: line.variantGid,
        quantity: line.quantity,
      };
    })
    .filter(Boolean);
  if (!lineItems.length) {
    return { ok: false, reason: 'missing_lines' };
  }

  const normalizedAttributes = normalizeCartAttributes(attributes);
  if (email) {
    const hasEmailAttribute = normalizedAttributes.some(
      (attr) => typeof attr?.key === 'string' && attr.key.toLowerCase() === 'customer_email',
    );
    if (!hasEmailAttribute && normalizedAttributes.length < 30) {
      normalizedAttributes.push({ key: 'customer_email', value: email });
    }
  }

  const input = {
    lineItems,
  };

  if (normalizedAttributes.length) {
    input.customAttributes = normalizedAttributes.map(({ key, value }) => ({ key, value }));
  }

  const noteValue = normalizeCartNote(note);
  if (noteValue) {
    input.note = noteValue;
  }

  const normalizedDiscount = typeof discountCode === 'string' ? discountCode.trim() : '';
  if (normalizedDiscount) {
    input.discountCode = normalizedDiscount;
  }

  if (typeof email === 'string' && email.trim()) {
    input.email = email.trim();
  }

  let resp;
  try {
    resp = await shopifyStorefrontGraphQL(
      CHECKOUT_CREATE_MUTATION,
      { input },
      buyerIp ? { buyerIp } : {},
    );
  } catch (err) {
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return { ok: false, reason: 'shopify_env_missing', missing: err.missing };
    }
    throw err;
  }

  const requestId = readRequestId(resp) || undefined;
  const rawBody = await resp.text();
  const json = parseJsonMaybe(rawBody);

  if (!resp.ok) {
    safeWarn('private_checkout_http_error', {
      status: resp.status,
      bodyPreview: typeof rawBody === 'string' ? rawBody.slice(0, 500) : '',
      requestId: requestId || null,
    });
    return {
      ok: false,
      reason: 'storefront_http_error',
      status: resp.status,
      body: typeof rawBody === 'string' ? rawBody.slice(0, 2000) : undefined,
      requestId,
    };
  }

  if (!json || typeof json !== 'object') {
    safeWarn('private_checkout_non_json', { requestId: requestId || null });
    return { ok: false, reason: 'storefront_invalid_response', requestId };
  }

  if (Array.isArray(json.errors) && json.errors.length) {
    safeWarn('private_checkout_graphql_errors', {
      errors: json.errors,
      requestId: requestId || null,
    });
    return { ok: false, reason: 'storefront_graphql_errors', errors: json.errors, requestId };
  }

  const payload = json?.data?.checkoutCreate;
  if (!payload || typeof payload !== 'object') {
    safeWarn('private_checkout_missing_payload', { requestId: requestId || null });
    return { ok: false, reason: 'storefront_invalid_response', requestId };
  }

  const interpretedErrors = interpretUserErrors(payload.checkoutUserErrors);
  if (interpretedErrors.userErrors.length) {
    safeWarn('private_checkout_user_errors', {
      userErrors: interpretedErrors.userErrors,
      requestId: requestId || null,
      reason: interpretedErrors.reason,
    });
    return {
      ok: false,
      reason: interpretedErrors.reason,
      userErrors: interpretedErrors.userErrors,
      friendlyMessage: interpretedErrors.friendlyMessage,
      requestId,
    };
  }

  const checkout = payload.checkout && typeof payload.checkout === 'object' ? payload.checkout : null;
  const webUrl = typeof checkout?.webUrl === 'string' ? checkout.webUrl.trim() : '';
  if (!webUrl) {
    safeWarn('private_checkout_missing_weburl', { requestId: requestId || null });
    return { ok: false, reason: 'missing_checkout_url', requestId };
  }

  safeInfo('private_checkout_success', {
    requestId: requestId || null,
    checkoutId: typeof checkout?.id === 'string' ? checkout.id : null,
  });

  return {
    ok: true,
    url: webUrl,
    checkoutId: typeof checkout?.id === 'string' ? checkout.id : undefined,
    requestId,
  };
}

export default async function privateCheckout(req, res) {
  safeInfo('private_checkout_incoming', {
    method: req.method,
    path: req.url || '',
  });
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
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
      safeWarn('private_checkout_invalid_body', { issues: parsed.error.flatten().fieldErrors });
      return sendJson(res, 400, { ok: false, reason: 'bad_request', issues: parsed.error.flatten().fieldErrors });
    }

    const {
      variantId,
      variantGid,
      quantity,
      lines,
      email,
      note,
      attributes,
      noteAttributes,
      discountCode,
      discount,
      productHandle,
    } = parsed.data;

    const normalizedLines = buildLinesFromBody({ variantId, variantGid, quantity, lines });
    if (!normalizedLines.length) {
      safeWarn('private_checkout_missing_variant', { body: parsed.data });
      return sendJson(res, 400, { ok: false, reason: 'missing_variant' });
    }

    const mergedAttributes = noteAttributes ?? attributes;
    const buyerIp = getClientIp(req);
    const checkoutResult = await createStorefrontCheckout({
      lines: normalizedLines,
      email,
      note,
      attributes: mergedAttributes,
      discountCode: discountCode || discount || undefined,
      buyerIp,
    });

    if (!checkoutResult.ok) {
      if (checkoutResult.reason === 'shopify_env_missing') {
        return sendJson(res, 500, {
          ok: false,
          reason: 'shopify_env_missing',
          missing: checkoutResult.missing,
        });
      }

      const status =
        checkoutResult.reason === 'missing_variant'
          ? 400
          : checkoutResult.reason === 'discount_code_invalid'
            ? 400
            : checkoutResult.reason === 'product_not_published_storefront'
              ? 409
              : checkoutResult.reason === 'storefront_user_errors'
                ? 400
                : checkoutResult.reason === 'missing_lines'
                  ? 400
                  : checkoutResult.reason === 'storefront_http_error'
                    ? 502
                    : checkoutResult.reason === 'storefront_graphql_errors'
                      ? 502
                      : checkoutResult.reason === 'storefront_invalid_response'
                        ? 502
                        : 502;

      const responsePayload = {
        ok: false,
        reason: checkoutResult.reason,
        ...(checkoutResult.userErrors ? { userErrors: checkoutResult.userErrors } : {}),
        ...(checkoutResult.errors ? { errors: checkoutResult.errors } : {}),
        ...(checkoutResult.status ? { status: checkoutResult.status } : {}),
        ...(checkoutResult.body ? { detail: checkoutResult.body } : {}),
        ...(checkoutResult.friendlyMessage ? { message: checkoutResult.friendlyMessage } : {}),
        ...(checkoutResult.requestId ? { requestIds: [checkoutResult.requestId] } : {}),
        ...(productHandle ? { productHandle } : {}),
      };

      if (checkoutResult.reason === 'product_not_published_storefront' && !responsePayload.message) {
        responsePayload.message = 'Producto no publicado en canal Storefront.';
      }

      return sendJson(res, status, responsePayload);
    }

    const successPayload = {
      ok: true,
      mode: 'storefront_checkout',
      url: checkoutResult.url,
      checkoutUrl: checkoutResult.url,
      ...(checkoutResult.checkoutId ? { checkoutId: checkoutResult.checkoutId } : {}),
      ...(checkoutResult.requestId ? { requestIds: [checkoutResult.requestId] } : {}),
    };

    return sendJson(res, 200, successPayload);
  } catch (err) {
    if (res.statusCode === 413) {
      safeWarn('private_checkout_payload_too_large', {});
      return sendJson(res, 413, { ok: false, reason: 'payload_too_large' });
    }
    if (res.statusCode === 400 && String(err?.code || err?.message).includes('invalid_json')) {
      safeWarn('private_checkout_invalid_json', {});
      return sendJson(res, 400, { ok: false, reason: 'invalid_json' });
    }
    safeError('private_checkout_unhandled', err);
    return sendJson(res, 500, { ok: false, reason: 'private_checkout_failed' });
  }
}

