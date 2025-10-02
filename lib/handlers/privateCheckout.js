import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import {
  resolveVariantIds,
  normalizeCartAttributes,
  normalizeCartNote,
} from '../shopify/cartHelpers.js';
import { shopifyAdminGraphQL, shopifyStorefrontGraphQL } from '../shopify.js';
import { getHeadlessPublicationId } from '../shopify/publication.js';

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

const CART_CREATE_MUTATION = `
  mutation CartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        message
        code
        field
      }
    }
  }
`;

const CART_DISCOUNT_CODES_UPDATE_MUTATION = `
  mutation CartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
    cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        message
        code
        field
      }
    }
  }
`;

const VARIANT_HEADLESS_STATUS_QUERY = `
  query PrivateCheckoutVariantStatus($id: ID!, $publicationId: ID!) {
    node(id: $id) {
      __typename
      ... on ProductVariant {
        id
        availableForSale
        product {
          id
          status
          title
          handle
          publishedOnPublication(publicationId: $publicationId)
        }
      }
    }
  }
`;

const HEADLESS_AVAILABILITY_MESSAGE =
  'Producto no disponible en canal Storefront (debe estar ACTIVO y publicado en Headless, no en Online Store).';

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

function ensurePublicationGid(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('gid://')) return raw;
  if (/^\d+$/.test(raw)) {
    return `gid://shopify/Publication/${raw}`;
  }
  return raw;
}

function logStorefrontRequestId(requestId, context) {
  if (!requestId) return;
  safeInfo('private_checkout_storefront_requestId', {
    requestId,
    ...(context ? { context } : {}),
  });
}

function mergeRequestIds(...lists) {
  const set = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      if (typeof value === 'string' && value.trim()) {
        set.add(value.trim());
      }
    }
  }
  return Array.from(set);
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
      reason: 'product_not_available_storefront',
      friendlyMessage: HEADLESS_AVAILABILITY_MESSAGE,
    };
  }

  return {
    userErrors,
    reason: 'storefront_user_errors',
    friendlyMessage: 'No pudimos generar el checkout privado. Probá de nuevo en unos segundos.',
  };
}

async function applyCartDiscountCodes({ cartId, discountCode, buyerIp }) {
  const code = typeof discountCode === 'string' ? discountCode.trim() : '';
  if (!cartId || !code) {
    return { ok: true, checkoutUrl: undefined, requestIds: [] };
  }

  let resp;
  try {
    resp = await shopifyStorefrontGraphQL(
      CART_DISCOUNT_CODES_UPDATE_MUTATION,
      { cartId, discountCodes: [code] },
      buyerIp ? { buyerIp } : {},
    );
  } catch (err) {
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return { ok: false, reason: 'shopify_env_missing', missing: err.missing, requestIds: [] };
    }
    throw err;
  }

  const requestId = readRequestId(resp) || undefined;
  if (requestId) {
    logStorefrontRequestId(requestId, 'cartDiscountCodesUpdate');
  }
  const rawBody = await resp.text();
  const json = parseJsonMaybe(rawBody);
  const requestIds = requestId ? [requestId] : [];

  if (!resp.ok) {
    return {
      ok: false,
      reason: 'storefront_http_error',
      status: resp.status,
      body: typeof rawBody === 'string' ? rawBody.slice(0, 2000) : undefined,
      requestIds,
    };
  }

  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'storefront_invalid_response', requestIds };
  }

  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'storefront_graphql_errors', errors: json.errors, requestIds };
  }

  const payload = json?.data?.cartDiscountCodesUpdate;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'storefront_invalid_response', requestIds };
  }

  const interpretedErrors = interpretUserErrors(payload.userErrors);
  if (interpretedErrors.userErrors.length) {
    return {
      ok: false,
      reason: interpretedErrors.reason,
      userErrors: interpretedErrors.userErrors,
      friendlyMessage: interpretedErrors.friendlyMessage,
      requestIds,
    };
  }

  const cart = payload.cart && typeof payload.cart === 'object' ? payload.cart : null;
  const checkoutUrl = typeof cart?.checkoutUrl === 'string' ? cart.checkoutUrl.trim() : undefined;

  return { ok: true, checkoutUrl, requestIds };
}

async function createCartCheckout({ lines, email, note, attributes, discountCode, buyerIp }) {
  const normalizedLines = Array.isArray(lines) ? lines : [];
  const cartLines = normalizedLines
    .map((line) => {
      if (!line || typeof line !== 'object') return null;
      const gidRaw = typeof line.variantGid === 'string' ? line.variantGid : '';
      const ensuredGid = gidRaw && gidRaw.startsWith('gid://')
        ? gidRaw
        : line.variantNumericId
          ? `gid://shopify/ProductVariant/${line.variantNumericId}`
          : '';
      if (!ensuredGid) return null;
      return {
        merchandiseId: ensuredGid,
        quantity: normalizeQuantity(line.quantity ?? 1),
      };
    })
    .filter(Boolean);

  if (!cartLines.length) {
    return { ok: false, reason: 'missing_lines', requestIds: [] };
  }

  const input = {
    lines: cartLines,
  };

  const normalizedAttributes = normalizeCartAttributes(attributes);
  if (normalizedAttributes.length) {
    input.attributes = normalizedAttributes.map(({ key, value }) => ({ key, value }));
  }

  const noteValue = normalizeCartNote(note);
  if (noteValue) {
    input.note = noteValue;
  }

  const trimmedEmail = typeof email === 'string' ? email.trim() : '';
  if (trimmedEmail) {
    input.buyerIdentity = { email: trimmedEmail };
  }

  let resp;
  try {
    resp = await shopifyStorefrontGraphQL(
      CART_CREATE_MUTATION,
      { input },
      buyerIp ? { buyerIp } : {},
    );
  } catch (err) {
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return {
        ok: false,
        reason: 'shopify_env_missing',
        missing: err.missing,
        requestIds: [],
      };
    }
    throw err;
  }

  const requestId = readRequestId(resp) || undefined;
  if (requestId) {
    logStorefrontRequestId(requestId, 'cartCreate');
  }
  const rawBody = await resp.text();
  const json = parseJsonMaybe(rawBody);
  const requestIds = requestId ? [requestId] : [];

  if (!resp.ok) {
    return {
      ok: false,
      reason: 'storefront_http_error',
      status: resp.status,
      body: typeof rawBody === 'string' ? rawBody.slice(0, 2000) : undefined,
      requestIds,
    };
  }

  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'storefront_invalid_response', requestIds };
  }

  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'storefront_graphql_errors', errors: json.errors, requestIds };
  }

  const payload = json?.data?.cartCreate;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'storefront_invalid_response', requestIds };
  }

  const interpretedErrors = interpretUserErrors(payload.userErrors);
  if (interpretedErrors.userErrors.length) {
    return {
      ok: false,
      reason: interpretedErrors.reason,
      userErrors: interpretedErrors.userErrors,
      friendlyMessage: interpretedErrors.friendlyMessage,
      requestIds,
    };
  }

  const cart = payload.cart && typeof payload.cart === 'object' ? payload.cart : null;
  const checkoutUrlRaw = typeof cart?.checkoutUrl === 'string' ? cart.checkoutUrl.trim() : '';
  if (!checkoutUrlRaw) {
    return { ok: false, reason: 'missing_checkout_url', requestIds };
  }

  const cartId = typeof cart?.id === 'string' ? cart.id : undefined;

  const discountResult = await applyCartDiscountCodes({ cartId, discountCode, buyerIp });
  if (!discountResult.ok) {
    return {
      ok: false,
      reason: discountResult.reason,
      userErrors: discountResult.userErrors,
      friendlyMessage: discountResult.friendlyMessage,
      errors: discountResult.errors,
      status: discountResult.status,
      body: discountResult.body,
      requestIds: mergeRequestIds(requestIds, discountResult.requestIds),
    };
  }

  const effectiveCheckoutUrl = discountResult.checkoutUrl || checkoutUrlRaw;

  return {
    ok: true,
    url: effectiveCheckoutUrl,
    cartId,
    requestIds: mergeRequestIds(requestIds, discountResult.requestIds),
  };
}

async function createStorefrontCheckout({ lines, email, note, attributes, discountCode, buyerIp }) {
  return createCartCheckout({ lines, email, note, attributes, discountCode, buyerIp });
}

async function validateHeadlessProductAvailability(lines) {
  const headlessPublicationRaw = getHeadlessPublicationId();
  const headlessPublicationId = ensurePublicationGid(headlessPublicationRaw);
  if (!headlessPublicationId) {
    return {
      ok: false,
      reason: 'headless_publication_missing',
      message: 'SHOPIFY_HEADLESS_PUBLICATION_ID missing',
      code: 'headless_publication_missing',
      requestIds: [],
    };
  }

  const uniqueVariantGids = Array.from(
    new Set(
      (Array.isArray(lines) ? lines : [])
        .map((line) => (typeof line?.variantGid === 'string' ? line.variantGid.trim() : ''))
        .filter((value) => value && value.startsWith('gid://')),
    ),
  );

  if (!uniqueVariantGids.length) {
    return { ok: false, reason: 'missing_variant_gid', requestIds: [] };
  }

  const requestIds = [];

  for (const variantGid of uniqueVariantGids) {
    let resp;
    try {
      resp = await shopifyAdminGraphQL(
        VARIANT_HEADLESS_STATUS_QUERY,
        { id: variantGid, publicationId: headlessPublicationId },
      );
    } catch (err) {
      if (err?.message === 'SHOPIFY_ENV_MISSING') {
        return {
          ok: false,
          reason: 'shopify_admin_env_missing',
          message: 'Faltan credenciales de Shopify Admin.',
          code: 'shopify_admin_env_missing',
          missing: err.missing,
          requestIds,
        };
      }
      throw err;
    }

    const requestId = readRequestId(resp) || undefined;
    if (requestId) {
      requestIds.push(requestId);
    }

    const rawBody = await resp.text();
    const json = parseJsonMaybe(rawBody);

    if (!resp.ok) {
      return {
        ok: false,
        reason: 'admin_http_error',
        status: resp.status,
        body: typeof rawBody === 'string' ? rawBody.slice(0, 2000) : undefined,
        code: 'admin_http_error',
        requestIds,
      };
    }

    if (!json || typeof json !== 'object') {
      return { ok: false, reason: 'admin_invalid_response', code: 'admin_invalid_response', requestIds };
    }

    if (Array.isArray(json.errors) && json.errors.length) {
      return {
        ok: false,
        reason: 'admin_graphql_errors',
        errors: json.errors,
        code: 'admin_graphql_errors',
        requestIds,
      };
    }

    const node = json?.data?.node;
    if (!node || node.__typename !== 'ProductVariant') {
      return {
        ok: false,
        reason: 'variant_not_found',
        code: 'variant_not_found',
        requestIds,
      };
    }

    const product = node.product && typeof node.product === 'object' ? node.product : null;
    const statusRaw = typeof product?.status === 'string' ? product.status.toUpperCase() : '';
    const publishedOnHeadless = product?.publishedOnPublication === true;
    const availableForSale = node.availableForSale === true;
    const productId = typeof product?.id === 'string' ? product.id : undefined;
    const productHandle = typeof product?.handle === 'string' ? product.handle : undefined;

    if (statusRaw !== 'ACTIVE' || !publishedOnHeadless || availableForSale === false) {
      return {
        ok: false,
        reason: 'product_not_available_storefront',
        message: HEADLESS_AVAILABILITY_MESSAGE,
        code: 'product_not_available_storefront',
        details: {
          variantId: variantGid,
          productId,
          productHandle,
          status: statusRaw || null,
          publishedOnHeadless,
          availableForSale,
        },
        requestIds,
      };
    }
  }

  return { ok: true, requestIds };
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

    const availability = await validateHeadlessProductAvailability(normalizedLines);
    if (!availability.ok) {
      const status =
        availability.reason === 'headless_publication_missing'
          ? 500
          : availability.reason === 'shopify_admin_env_missing'
            ? 500
            : availability.reason === 'admin_http_error'
              ? 502
              : availability.reason === 'admin_graphql_errors'
                ? 502
                : 400;

      const responsePayload = {
        ok: false,
        reason: availability.reason,
        ...(availability.code ? { code: availability.code } : {}),
        ...(availability.message ? { message: availability.message } : {}),
        ...(availability.details ? { details: availability.details } : {}),
        ...(availability.errors ? { errors: availability.errors } : {}),
        ...(availability.status ? { status: availability.status } : {}),
        ...(availability.body ? { detail: availability.body } : {}),
        ...(availability.requestIds && availability.requestIds.length
          ? { requestIds: availability.requestIds }
          : {}),
      };

      return sendJson(res, status, responsePayload);
    }

    const preflightRequestIds = Array.isArray(availability.requestIds)
      ? availability.requestIds
      : [];

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
              : checkoutResult.reason === 'product_not_available_storefront'
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
        ...(checkoutResult.requestIds && checkoutResult.requestIds.length
          ? { requestIds: mergeRequestIds(preflightRequestIds, checkoutResult.requestIds) }
          : preflightRequestIds.length
            ? { requestIds: preflightRequestIds }
            : {}),
        ...(productHandle ? { productHandle } : {}),
      };

      if (checkoutResult.reason === 'product_not_published_storefront' && !responsePayload.message) {
        responsePayload.message = 'Producto no publicado en canal Storefront.';
      }
      if (checkoutResult.reason === 'product_not_available_storefront' && !responsePayload.message) {
        responsePayload.message = HEADLESS_AVAILABILITY_MESSAGE;
      }

      return sendJson(res, status, responsePayload);
    }

    const successPayload = {
      ok: true,
      mode: 'storefront_checkout',
      url: checkoutResult.url,
      checkoutUrl: checkoutResult.url,
      ...(checkoutResult.checkoutId ? { checkoutId: checkoutResult.checkoutId } : {}),
      ...(checkoutResult.cartId ? { cartId: checkoutResult.cartId } : {}),
      ...(checkoutResult.requestIds && checkoutResult.requestIds.length
        ? { requestIds: mergeRequestIds(preflightRequestIds, checkoutResult.requestIds) }
        : preflightRequestIds.length
          ? { requestIds: preflightRequestIds }
          : {}),
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

