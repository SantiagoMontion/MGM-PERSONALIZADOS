import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import {
  resolveVariantIds,
  normalizeCartAttributes,
  normalizeCartNote,
  createStorefrontCart,
} from '../shopify/cartHelpers.js';
import { shopifyAdminGraphQL, shopifyAdmin } from '../shopify.js';

const REQUIRED_SCOPES = ['write_draft_orders', 'read_products'];
const REQUIRED_API_VERSION = '2024-07';

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
    email: z.string().email().optional(),
    note: z.any().optional(),
    attributes: z.any().optional(),
    noteAttributes: z.any().optional(),
    productHandle: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

function resolveMode() {
  return 'draft_order';
}

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        invoiceUrl
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const DRAFT_ORDER_INVOICE_SEND_MUTATION = `
  mutation DraftOrderInvoiceSend($id: ID!, $input: DraftOrderInvoiceInput!) {
    draftOrderInvoiceSend(id: $id, input: $input) {
      draftOrder {
        id
        invoiceUrl
      }
      userErrors {
        field
        message
        code
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

function formatUserErrors(rawErrors) {
  if (!Array.isArray(rawErrors)) return [];
  return rawErrors
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const message = typeof entry.message === 'string' ? entry.message.trim() : '';
      if (!message) return null;
      const code = typeof entry.code === 'string' ? entry.code : undefined;
      const field = Array.isArray(entry.field)
        ? entry.field.map((item) => String(item)).filter(Boolean)
        : undefined;
      return {
        message,
        ...(code ? { code } : {}),
        ...(field && field.length ? { field } : {}),
      };
    })
    .filter(Boolean);
}

function formatGraphQLErrors(rawErrors) {
  if (!Array.isArray(rawErrors)) return [];
  return rawErrors
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const message = typeof entry.message === 'string' ? entry.message.trim() : '';
      const code = typeof entry.code === 'string'
        ? entry.code
        : typeof entry?.extensions?.code === 'string'
          ? entry.extensions.code
          : undefined;
      if (!message && !code) return null;
      return {
        ...(message ? { message } : {}),
        ...(code ? { code } : {}),
      };
    })
    .filter(Boolean);
}

function readScopesFromEnv() {
  const candidates = [
    'SHOPIFY_API_SCOPES',
    'SHOPIFY_SCOPES',
    'SHOPIFY_APP_SCOPES',
    'SHOPIFY_ADMIN_SCOPES',
    'SHOPIFY_ADMIN_API_SCOPES',
  ];
  for (const name of candidates) {
    if (!name) continue;
    const raw = typeof process.env[name] === 'string' ? process.env[name].trim() : '';
    if (raw) return raw;
  }
  return '';
}

function parseScopes(raw) {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function fetchAdminAccessScopes() {
  let resp;
  try {
    resp = await shopifyAdmin('oauth/access_scopes.json', { method: 'GET' });
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return { ok: false, reason: 'shopify_env_missing', missing: err.missing };
    }
    safeWarn('private_checkout_scope_fetch_exception', {
      message: typeof err?.message === 'string' ? err.message : undefined,
    });
    return { ok: false, reason: 'request_failed' };
  }
  const requestId = readRequestId(resp);
  const textBody = await resp.text();
  const json = parseJsonMaybe(textBody);
  if (!resp.ok) {
    safeWarn('private_checkout_scope_fetch_http_error', {
      status: resp.status,
      requestId: requestId || null,
    });
    return {
      ok: false,
      reason: 'http_error',
      status: resp.status,
      requestId,
      body: textBody?.slice(0, 1000),
    };
  }
  if (!json || typeof json !== 'object') {
    safeWarn('private_checkout_scope_fetch_invalid', {
      requestId: requestId || null,
    });
    return { ok: false, reason: 'invalid_response', requestId };
  }
  const scopes = Array.isArray(json.access_scopes)
    ? json.access_scopes
        .map((entry) => {
          if (!entry) return '';
          if (typeof entry === 'string') return entry;
          if (typeof entry.handle === 'string') return entry.handle;
          return '';
        })
        .filter(Boolean)
    : [];
  safeInfo('private_checkout_access_scopes', {
    requestId: requestId || null,
    scopesCount: scopes.length,
  });
  return { ok: true, scopes, requestId };
}

async function ensureShopifyRequirements() {
  const scopesRaw = readScopesFromEnv();
  const scopes = new Set(parseScopes(scopesRaw).map((scope) => scope.toLowerCase()));
  let missingScopes = REQUIRED_SCOPES.filter((scope) => !scopes.has(scope));
  let scopeSource = scopesRaw ? 'env' : 'unknown';
  let scopeRequestId;
  if (missingScopes.length) {
    const accessScopes = await fetchAdminAccessScopes();
    if (accessScopes.ok) {
      const accessSet = new Set(accessScopes.scopes.map((scope) => scope.toLowerCase()));
      missingScopes = REQUIRED_SCOPES.filter((scope) => !accessSet.has(scope));
      scopeSource = 'api';
      scopeRequestId = accessScopes.requestId;
    } else if (accessScopes.reason === 'shopify_env_missing') {
      return { ok: false, reason: 'shopify_env_missing', missing: accessScopes.missing };
    } else {
      scopeRequestId = accessScopes.requestId;
      safeWarn('private_checkout_scope_probe_failed', {
        reason: accessScopes.reason || 'unknown',
        status: accessScopes.status,
        requestId: scopeRequestId || null,
      });
    }
  }
  const apiVersionRaw = typeof process.env.SHOPIFY_API_VERSION === 'string'
    ? process.env.SHOPIFY_API_VERSION.trim()
    : '';
  const hasVersion = Boolean(apiVersionRaw);
  const versionMismatch = hasVersion && apiVersionRaw !== REQUIRED_API_VERSION;
  if (missingScopes.length || !hasVersion || versionMismatch) {
    safeWarn('private_checkout_env_error', {
      missingScopes: missingScopes.length ? missingScopes : undefined,
      apiVersion: apiVersionRaw || null,
      requiredVersion: REQUIRED_API_VERSION,
      hasVersion,
      versionMismatch,
      scopeSource,
      scopeRequestId: scopeRequestId || undefined,
    });
    return {
      ok: false,
      missingScopes,
      apiVersion: apiVersionRaw,
      hasVersion,
      versionMismatch,
      scopeSource,
      scopeRequestId,
    };
  }
  return { ok: true };
}

async function attemptStorefrontCheckoutFallback({ req, variantGid, quantity, note, attributes, email }) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid' };
  }

  const baseAttributes = Array.isArray(attributes)
    ? attributes
        .map((attr) => {
          if (!attr || typeof attr !== 'object') return null;
          const key = typeof attr.key === 'string' ? attr.key : typeof attr.name === 'string' ? attr.name : '';
          if (!key) return null;
          const value = typeof attr.value === 'string' ? attr.value : attr.value == null ? '' : String(attr.value);
          return { key, value };
        })
        .filter(Boolean)
    : [];

  const fallbackAttributes = baseAttributes.slice();
  const pushAttr = (key, value) => {
    if (!key || typeof key !== 'string') return;
    const trimmedKey = key.trim();
    if (!trimmedKey) return;
    fallbackAttributes.push({ key: trimmedKey, value: value == null ? '' : String(value) });
  };

  pushAttr('mgm_source', 'private-fallback');
  if (email) {
    pushAttr('customer_email', email);
  }

  const normalizedFallbackAttributes = normalizeCartAttributes(fallbackAttributes);

  const buyerIp = (() => {
    try {
      return getClientIp(req);
    } catch {
      return undefined;
    }
  })();

  let fallbackResult;
  try {
    fallbackResult = await createStorefrontCart({
      variantGid,
      quantity,
      note,
      attributes: normalizedFallbackAttributes,
      buyerIp,
    });
  } catch (err) {
    safeWarn('private_checkout_storefront_fallback_exception', {
      message: typeof err?.message === 'string' ? err.message : undefined,
    });
    return { ok: false, reason: 'exception' };
  }

  if (fallbackResult?.ok && fallbackResult.checkoutUrl) {
    safeInfo('private_checkout_storefront_fallback_success', {
      cartId: fallbackResult.cartId || null,
      checkoutUrl: fallbackResult.checkoutPlain || fallbackResult.checkoutUrl || null,
      requestId: fallbackResult.requestId || null,
    });
    return {
      ok: true,
      url: fallbackResult.checkoutUrl,
      cartUrl: fallbackResult.cartUrl,
      requestId: fallbackResult.requestId,
    };
  }

  safeWarn('private_checkout_storefront_fallback_failed', {
    reason: fallbackResult?.reason || 'unknown',
    status: fallbackResult?.status,
    requestId: fallbackResult?.requestId || null,
  });

  if (fallbackResult?.reason === 'storefront_env_missing') {
    return { ok: false, reason: 'storefront_env_missing', missing: fallbackResult.missing };
  }

  return {
    ok: false,
    reason: fallbackResult?.reason || 'unknown',
    status: fallbackResult?.status,
    requestId: fallbackResult?.requestId,
  };
}

function buildDraftOrderInput({ variantGid, quantity, note, attributes, email }) {
  const qty = normalizeQuantity(quantity);
  const input = {
    lineItems: [
      {
        variantId: variantGid,
        quantity: qty,
      },
    ],
    tags: ['private', 'custom-mockup'],
  };
  const noteValue = normalizeCartNote(note);
  if (noteValue) {
    input.note = noteValue;
  }
  if (email) {
    input.email = email;
  }
  if (Array.isArray(attributes) && attributes.length) {
    input.customAttributes = attributes.map((attr) => ({ key: attr.key, value: attr.value }));
  }
  return input;
}

async function createDraftOrder({ variantGid, quantity, note, attributes, email }) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid' };
  }
  const customAttributes = normalizeCartAttributes(attributes);
  const input = buildDraftOrderInput({ variantGid, quantity, note, attributes: customAttributes, email });
  safeInfo('draft_order_create_attempt', {
    variantId: variantGid,
    quantity: normalizeQuantity(quantity),
    hasEmail: Boolean(email),
    hasNote: Boolean(normalizeCartNote(note)),
    attributesCount: Array.isArray(customAttributes) ? customAttributes.length : 0,
  });
  let resp;
  try {
    resp = await shopifyAdminGraphQL(DRAFT_ORDER_CREATE_MUTATION, { input });
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return { ok: false, reason: 'shopify_env_missing', missing: err.missing };
    }
    throw err;
  }
  const requestId = readRequestId(resp);
  const textBody = await resp.text();
  const json = parseJsonMaybe(textBody);
  if (!resp.ok) {
    return {
      ok: false,
      reason: 'http_error',
      status: resp.status,
      body: textBody?.slice(0, 2000),
      requestId,
    };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId };
  }
  const graphqlErrors = Array.isArray(json.errors) ? json.errors : [];
  if (graphqlErrors.length) {
    const formattedErrors = formatGraphQLErrors(graphqlErrors);
    safeWarn('draft_order_graphql_errors', {
      requestId: requestId || null,
      errors: formattedErrors,
    });
    return {
      ok: false,
      reason: 'graphql_errors',
      errors: formattedErrors,
      requestId,
    };
  }
  const payload = json?.data?.draftOrderCreate;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId };
  }
  const userErrors = formatUserErrors(payload.userErrors);
  if (userErrors.length) {
    safeWarn('draft_order_user_errors', {
      requestId: requestId || null,
      userErrors,
    });
    return {
      ok: false,
      reason: 'user_errors',
      userErrors,
      requestId,
    };
  }
  const draftOrder = payload.draftOrder && typeof payload.draftOrder === 'object' ? payload.draftOrder : null;
  const draftOrderId = typeof draftOrder?.id === 'string' ? draftOrder.id : '';
  if (!draftOrderId) {
    return { ok: false, reason: 'missing_draft_order', requestId };
  }
  const invoiceUrl = typeof draftOrder?.invoiceUrl === 'string' ? draftOrder.invoiceUrl.trim() : '';
  safeInfo('draft_order_create_success', {
    requestId: requestId || null,
    draftOrderId,
  });
  return {
    ok: true,
    draftOrderId,
    invoiceUrl,
    requestId,
  };
}

async function sendDraftOrderInvoice({ draftOrderId, email }) {
  let resp;
  try {
    resp = await shopifyAdminGraphQL(DRAFT_ORDER_INVOICE_SEND_MUTATION, {
      id: draftOrderId,
      input: email ? { to: email } : {},
    });
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return { ok: false, reason: 'shopify_env_missing', missing: err.missing };
    }
    throw err;
  }
  const requestId = readRequestId(resp);
  const textBody = await resp.text();
  const json = parseJsonMaybe(textBody);
  if (!resp.ok) {
    return {
      ok: false,
      reason: 'invoice_http_error',
      status: resp.status,
      body: textBody?.slice(0, 2000),
      requestId,
    };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'invoice_invalid_response', requestId };
  }
  const graphqlErrors = Array.isArray(json.errors) ? json.errors : [];
  if (graphqlErrors.length) {
    const formattedErrors = formatGraphQLErrors(graphqlErrors);
    safeWarn('draft_order_graphql_errors', {
      requestId: requestId || null,
      errors: formattedErrors,
      phase: 'invoice_send',
    });
    return {
      ok: false,
      reason: 'invoice_graphql_errors',
      errors: formattedErrors,
      requestId,
    };
  }
  const payload = json?.data?.draftOrderInvoiceSend;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invoice_invalid_response', requestId };
  }
  const userErrors = formatUserErrors(payload.userErrors);
  if (userErrors.length) {
    safeWarn('draft_order_user_errors', {
      requestId: requestId || null,
      userErrors,
      phase: 'invoice_send',
    });
    return {
      ok: false,
      reason: 'invoice_user_errors',
      userErrors,
      requestId,
    };
  }
  const invoiceDraftOrder = payload.draftOrder && typeof payload.draftOrder === 'object' ? payload.draftOrder : null;
  const invoiceUrl = typeof invoiceDraftOrder?.invoiceUrl === 'string' ? invoiceDraftOrder.invoiceUrl.trim() : '';
  if (!invoiceUrl) {
    return { ok: false, reason: 'missing_invoice_url', requestId };
  }
  safeInfo('draft_order_invoice_send_success', {
    requestId: requestId || null,
    invoiceUrl,
  });
  return {
    ok: true,
    invoiceUrl,
    requestId,
  };
}

function buildProductFallbackUrl(handle) {
  if (typeof handle !== 'string') return '';
  const normalized = handle.trim();
  if (!normalized) return '';
  return `https://www.mgmgamers.store/products/${normalized}`;
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
      return sendJson(res, 400, { ok: false, reason: 'bad_request' });
    }
    const {
      variantId,
      variantGid,
      quantity,
      email,
      note,
      attributes,
      noteAttributes,
      productHandle,
    } = parsed.data;
    let { variantNumericId, variantGid: resolvedVariantGid } = resolveVariantIds({ variantId, variantGid });
    if (!variantNumericId) {
      return sendJson(res, 400, { ok: false, reason: 'bad_request' });
    }
    if (!resolvedVariantGid || !resolvedVariantGid.startsWith('gid://shopify/ProductVariant/')) {
      resolvedVariantGid = `gid://shopify/ProductVariant/${variantNumericId}`;
    }
    const qty = normalizeQuantity(quantity);
    const mode = resolveMode();
    safeInfo('private_checkout_request', {
      variantGid: resolvedVariantGid,
      quantity: qty,
      mode,
    });

    const attributesInput = noteAttributes ?? attributes;
    const normalizedAttributes = normalizeCartAttributes(attributesInput);

    const requirementCheck = await ensureShopifyRequirements();
    if (!requirementCheck.ok) {
      if (requirementCheck.reason === 'shopify_env_missing') {
        return sendJson(res, 500, {
          ok: false,
          reason: 'shopify_env_missing',
          missing: requirementCheck.missing,
        });
      }

      const fallbackResult = await attemptStorefrontCheckoutFallback({
        req,
        variantGid: resolvedVariantGid,
        quantity: qty,
        note,
        attributes: normalizedAttributes,
        email,
      });

      if (fallbackResult.ok && fallbackResult.url) {
        const requestIds = fallbackResult.requestId ? [fallbackResult.requestId] : undefined;
        return sendJson(res, 200, {
          ok: true,
          mode: 'storefront_checkout',
          url: fallbackResult.url,
          warningMessages: [
            'No pudimos generar un checkout privado. Abrimos el checkout estándar de Shopify.',
          ],
          ...(requestIds ? { requestIds } : {}),
        });
      }

      return sendJson(res, 500, {
        ok: false,
        reason: 'missing_scope_or_version',
        ...(requirementCheck.missingScopes?.length ? { missingScopes: requirementCheck.missingScopes } : {}),
        ...(requirementCheck.apiVersion ? { apiVersion: requirementCheck.apiVersion } : {}),
        ...(requirementCheck.scopeSource ? { scopeSource: requirementCheck.scopeSource } : {}),
        ...(requirementCheck.scopeRequestId ? { scopeRequestId: requirementCheck.scopeRequestId } : {}),
        ...(fallbackResult
          ? {
              fallback: {
                type: 'storefront_checkout',
                ...(fallbackResult.reason ? { reason: fallbackResult.reason } : {}),
                ...(fallbackResult.status ? { status: fallbackResult.status } : {}),
                ...(fallbackResult.requestId ? { requestId: fallbackResult.requestId } : {}),
                ...(Array.isArray(fallbackResult.missing) ? { missing: fallbackResult.missing } : {}),
              },
            }
          : {}),
      });
    }

    let draftOrderResult;
    try {
      draftOrderResult = await createDraftOrder({
        variantGid: resolvedVariantGid,
        quantity: qty,
        note,
        attributes: normalizedAttributes,
        email,
      });
    } catch (err) {
      safeError('draft_order_create_exception', err);
      return sendJson(res, 502, { ok: false, reason: 'shopify_unreachable' });
    }

    if (!draftOrderResult.ok) {
      if (draftOrderResult.reason === 'shopify_env_missing') {
        return sendJson(res, 500, {
          ok: false,
          reason: 'shopify_env_missing',
          missing: draftOrderResult.missing,
        });
      }
      if (draftOrderResult.reason === 'user_errors') {
        const fallbackUrl = buildProductFallbackUrl(productHandle);
        if (fallbackUrl) {
          safeInfo('private_checkout_product_page_fallback', {
            variantGid: resolvedVariantGid,
            productHandle,
            requestId: draftOrderResult.requestId || null,
          });
          return sendJson(res, 200, {
            ok: true,
            mode: 'product_page_fallback',
            url: fallbackUrl,
          });
        }
      }
      return sendJson(res, 502, {
        ok: false,
        reason: 'draft_order_failed',
        ...(draftOrderResult.userErrors?.length ? { userErrors: draftOrderResult.userErrors } : {}),
        ...(draftOrderResult.errors?.length ? { errors: draftOrderResult.errors } : {}),
        ...(draftOrderResult.status ? { status: draftOrderResult.status } : {}),
        ...(draftOrderResult.body ? { detail: draftOrderResult.body } : {}),
        ...(draftOrderResult.requestId ? { requestId: draftOrderResult.requestId } : {}),
      });
    }

    const requestIds = draftOrderResult.requestId ? [draftOrderResult.requestId] : [];

    const invoiceResult = await sendDraftOrderInvoice({
      draftOrderId: draftOrderResult.draftOrderId,
      email,
    }).catch((err) => {
      safeError('draft_order_invoice_exception', err);
      return { ok: false, reason: 'invoice_exception' };
    });

    if (!invoiceResult.ok) {
      if (invoiceResult.reason === 'shopify_env_missing') {
        return sendJson(res, 500, {
          ok: false,
          reason: 'shopify_env_missing',
          missing: invoiceResult.missing,
          ...(invoiceResult.requestId ? { requestId: invoiceResult.requestId } : {}),
        });
      }
      return sendJson(res, 502, {
        ok: false,
        reason: 'draft_order_failed',
        ...(invoiceResult.userErrors?.length ? { userErrors: invoiceResult.userErrors } : {}),
        ...(invoiceResult.errors?.length ? { errors: invoiceResult.errors } : {}),
        ...(invoiceResult.status ? { status: invoiceResult.status } : {}),
        ...(invoiceResult.body ? { detail: invoiceResult.body } : {}),
        ...(invoiceResult.requestId ? { requestId: invoiceResult.requestId } : {}),
        ...(requestIds.length ? { requestIds: requestIds.concat(invoiceResult.requestId ? [invoiceResult.requestId] : []) } : {}),
      });
    }

    const combinedRequestIds = requestIds.slice();
    if (invoiceResult.requestId) {
      combinedRequestIds.push(invoiceResult.requestId);
    }

    return sendJson(res, 200, {
      ok: true,
      mode: 'draft_order',
      url: invoiceResult.invoiceUrl,
      draftOrderId: draftOrderResult.draftOrderId,
      ...(combinedRequestIds.length ? { requestIds: combinedRequestIds } : {}),
    });
  } catch (err) {
    if (res.statusCode === 413) {
      return sendJson(res, 413, { ok: false, reason: 'payload_too_large' });
    }
    if (res.statusCode === 400 && err?.code === 'invalid_json') {
      return sendJson(res, 400, { ok: false, reason: 'bad_request' });
    }
    safeError('[private-checkout] unhandled_error', err);
    return sendJson(res, 500, { ok: false, reason: 'internal_error' });
  }
}
