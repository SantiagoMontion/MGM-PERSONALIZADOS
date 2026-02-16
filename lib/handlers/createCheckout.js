import { buildStubRequestId, resolveFrontOrigin } from '../_lib/stubHelpers.js';
import { runWithLenientCors, sendCorsOptions, sendJsonWithCors } from '../../api/_lib/lenientCors.js';
import { collectMissingEnv } from '../../api/_lib/envChecks.js';
import { createDiagId, logApiError } from '../../api/_lib/diag.js';

const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';
const REQUIRED_ENV = [
  'SHOPIFY_STORE_DOMAIN',
  ['SHOPIFY_STOREFRONT_API_TOKEN', 'SHOPIFY_STOREFRONT_TOKEN'],
  'SHOPIFY_API_VERSION',
];
const SHOPIFY_TIMEOUT_MS = 20000;
const OFFICIAL_ALLOWED_ORIGINS = [
  'https://TU-DOMINIO-OFICIAL.COM', // Reemplaza este placeholder por tu dominio oficial
];
const CHECKOUT_CREATE_MUTATION = `
  mutation($input: CheckoutCreateInput!) {
    checkoutCreate(input: $input) {
      checkout {
        id
        webUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function buildStubCheckoutPayload() {
  const rid = buildStubRequestId();
  const origin = resolveFrontOrigin();
  const checkoutUrl = `${origin}/mockup?rid=${encodeURIComponent(rid)}&step=checkout&from=create-checkout`;

  return {
    ok: true,
    stub: true,
    url: checkoutUrl,
    checkoutUrl,
    message: null,
    missing: [],
  };
}

function resolveStorefrontToken() {
  const candidates = [process.env.SHOPIFY_STOREFRONT_API_TOKEN, process.env.SHOPIFY_STOREFRONT_TOKEN];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function parseQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const rounded = Math.floor(raw);
  return Math.min(Math.max(rounded, 1), 100);
}

function normalizeVariantNumericId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) {
    return raw;
  }
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

function normalizeVariantGid(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^gid:\/\//i.test(raw)) {
    return raw;
  }
  if (/^\d+$/.test(raw)) {
    return `gid://shopify/ProductVariant/${raw}`;
  }
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  if (match) {
    return `gid://shopify/ProductVariant/${match[1]}`;
  }
  return raw;
}

function extractString(candidate, keys) {
  if (!candidate || typeof candidate !== 'object') return '';
  for (const key of keys) {
    if (!key) continue;
    const value = candidate?.[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function extractVariantFromBody(body) {
  const variantCandidates = [];
  const potentialSources = [
    body,
    body?.variant,
    body?.lastProduct,
    body?.product,
    body?.defaultVariant,
    body?.default_variant,
  ];

  for (const source of potentialSources) {
    if (!source || typeof source !== 'object') continue;
    const candidatesForSource = [
      source.variantId,
      source.variant_id,
      source.variantGid,
      source.variant_gid,
      source.id,
      source.gid,
      source.legacyResourceId,
      source.legacy_resource_id,
      source.variantIdNumeric,
      source.variant_id_numeric,
    ];
    for (const candidate of candidatesForSource) {
      if (candidate == null) continue;
      variantCandidates.push(candidate);
    }

    if (Array.isArray(source.variants)) {
      for (const entry of source.variants) {
        if (!entry || typeof entry !== 'object') continue;
        const entryCandidates = [entry.id, entry.variantId, entry.variant_id, entry.legacyResourceId];
        for (const candidate of entryCandidates) {
          if (candidate == null) continue;
          variantCandidates.push(candidate);
        }
      }
    }
  }

  const variantNumeric = (() => {
    for (const candidate of variantCandidates) {
      const normalized = normalizeVariantNumericId(candidate);
      if (normalized) return normalized;
    }
    return '';
  })();

  let variantGid = '';
  for (const candidate of variantCandidates) {
    const normalized = normalizeVariantGid(candidate);
    if (normalized && normalized.startsWith('gid://')) {
      variantGid = normalized;
      break;
    }
  }
  if (!variantGid && variantNumeric) {
    variantGid = `gid://shopify/ProductVariant/${variantNumeric}`;
  }

  const productHandle = extractString(body, [
    'productHandle',
    'product_handle',
    'handle',
  ])
    || extractString(body?.product, ['handle', 'productHandle', 'product_handle'])
    || extractString(body?.lastProduct, ['productHandle', 'product_handle', 'handle']);

  return { variantNumeric, variantGid, productHandle };
}

async function readJsonBody(req) {
  if (req?.body && typeof req.body === 'object') {
    return req.body;
  }

  const MAX_SIZE = 1024 * 1024; // 1MB
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const handleError = (err) => {
      const error = err || new Error('invalid_body');
      error.code = error.code || 'invalid_body';
      safeReject(error);
    };

    try {
      req.on('data', (chunk) => {
        if (chunk == null) return;
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(bufferChunk);
        size += bufferChunk.length;
        if (size > MAX_SIZE) {
          const error = new Error('payload_too_large');
          error.code = 'payload_too_large';
          safeReject(error);
          try {
            req.destroy?.(error);
          } catch {}
        }
      });
      req.on('error', handleError);
      req.on('end', () => {
        try {
          if (!chunks.length) {
            safeResolve({});
            return;
          }
          const buffer = Buffer.concat(chunks);
          const raw = buffer.toString('utf8');
          if (!raw) {
            safeResolve({});
            return;
          }
          safeResolve(JSON.parse(raw));
        } catch (err) {
          const parseError = err || new Error('invalid_json');
          parseError.code = 'invalid_json';
          safeReject(parseError);
        }
      });
    } catch (err) {
      safeReject(err);
    }
  });
}

function buildAbortController() {
  if (typeof AbortController !== 'function') {
    return { controller: null, dispose: () => {} };
  }
  const controller = new AbortController();
  const reason = new Error('shopify_timeout');
  reason.code = 'SHOPIFY_TIMEOUT';
  reason.step = 'shopify_storefront_checkout_create';
  const timer = setTimeout(() => {
    try {
      controller.abort(reason);
    } catch {}
  }, SHOPIFY_TIMEOUT_MS);
  const dispose = () => {
    clearTimeout(timer);
  };
  return { controller, dispose };
}

function normalizeAttributeValue(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 255);
}

function pickHeaderValue(headers, name) {
  if (!headers || typeof name !== 'string') return '';
  const lower = name.toLowerCase();
  const upper = name.toUpperCase();
  const raw = headers[name] ?? headers[lower] ?? headers[upper];
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' ? raw[0] : '';
  }
  return typeof raw === 'string' ? raw : '';
}

function extractTrackingFields(body, headers) {
  const ridValue =
    (typeof body?.rid === 'string' && body.rid) ||
    (typeof body?.rid === 'number' ? String(body.rid) : '') ||
    pickHeaderValue(headers, 'x-rid');
  const designSlugValue =
    (typeof body?.design_slug === 'string' && body.design_slug) ||
    (typeof body?.designSlug === 'string' && body.designSlug) ||
    pickHeaderValue(headers, 'x-design-slug');

  const rid = normalizeAttributeValue(ridValue);
  const designSlug = normalizeAttributeValue(designSlugValue);

  return { rid, designSlug };
}

function buildLineItemAttributes({ rid, designSlug }) {
  const customAttributes = [];
  if (rid) {
    customAttributes.push({ key: 'rid', value: rid });
  }
  if (designSlug) {
    customAttributes.push({ key: 'design_slug', value: designSlug });
  }
  return customAttributes;
}

async function callShopifyCheckoutCreate({ variantId, quantity, discountCode, rid, designSlug }) {
  const token = resolveStorefrontToken();
  const domain = resolveShopDomain();
  const apiVersionRaw = typeof process.env.SHOPIFY_API_VERSION === 'string' ? process.env.SHOPIFY_API_VERSION.trim() : '';
  const apiVersion = apiVersionRaw || '2024-07';
  const endpoint = `https://${domain}/api/${apiVersion}/graphql.json`;
  const lineItem = {
    variantId,
    quantity,
  };
  const customAttributes = buildLineItemAttributes({ rid, designSlug });
  if (customAttributes.length) {
    lineItem.customAttributes = customAttributes;
  }

  const input = {
    lineItems: [lineItem],
  };
  if (discountCode) {
    input.discountCode = discountCode;
  }

  const { controller, dispose } = buildAbortController();
  let response;
  let text = '';
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Shopify-Storefront-Access-Token': token,
      },
      body: JSON.stringify({ query: CHECKOUT_CREATE_MUTATION, variables: { input } }),
      signal: controller ? controller.signal : undefined,
    });
    text = await response.text();
  } catch (err) {
    if (controller?.signal?.aborted) {
      const reason = controller.signal.reason;
      if (reason && typeof reason === 'object' && reason.code === 'SHOPIFY_TIMEOUT') {
        throw reason;
      }
      const timeoutError = new Error('shopify_timeout');
      timeoutError.code = 'SHOPIFY_TIMEOUT';
      timeoutError.step = 'shopify_storefront_checkout_create';
      throw timeoutError;
    }
    throw err;
  } finally {
    dispose();
  }

  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  const requestId = response?.headers?.get?.('x-request-id') || response?.headers?.get?.('X-Request-Id') || null;

  if (!response.ok) {
    return { ok: false, type: 'http_error', status: response.status, body: text, requestId };
  }

  if (!json || typeof json !== 'object') {
    return { ok: false, type: 'invalid_response', requestId };
  }

  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, type: 'graphql_errors', errors: json.errors, requestId };
  }

  const payload = json?.data?.checkoutCreate;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, type: 'invalid_response', requestId };
  }

  const checkout = payload.checkout && typeof payload.checkout === 'object' ? payload.checkout : {};
  const checkoutId = typeof checkout.id === 'string' ? checkout.id : null;
  const webUrl = typeof checkout.webUrl === 'string' ? checkout.webUrl.trim() : '';

  const userErrors = Array.isArray(payload.userErrors)
    ? payload.userErrors
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const message = typeof entry.message === 'string' ? entry.message.trim() : '';
          if (!message) return null;
          const field = Array.isArray(entry.field)
            ? entry.field.filter((part) => typeof part === 'string' && part.trim())
            : typeof entry.field === 'string'
              ? [entry.field]
              : [];
          return {
            field: field.length ? field : undefined,
            message,
          };
        })
        .filter(Boolean)
    : [];

  if (userErrors.length) {
    return { ok: false, type: 'user_errors', userErrors, checkoutId, requestId };
  }

  if (!webUrl) {
    return { ok: false, type: 'missing_checkout_url', checkoutId, requestId };
  }

  return { ok: true, checkoutUrl: webUrl, checkoutId, requestId };
}

function buildCartFallbackUrl(domain, variantNumericId, quantity, discountCode) {
  if (!domain || !variantNumericId) return '';
  const normalizedDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!normalizedDomain) return '';
  const qty = parseQuantity(quantity);
  const baseUrl = `https://${normalizedDomain}/cart/${variantNumericId}:${qty}`;
  const discount = typeof discountCode === 'string' ? discountCode.trim() : '';
  if (!discount) {
    return baseUrl;
  }
  const sanitizedDiscount = discount.replace(/[^A-Za-z0-9-_]/g, '');
  if (!sanitizedDiscount) {
    return baseUrl;
  }
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}discount=${encodeURIComponent(sanitizedDiscount)}`;
}

function buildProductFallbackUrl(domain, handle) {
  if (!domain || !handle) return '';
  const normalizedDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const trimmedHandle = handle.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalizedDomain || !trimmedHandle) return '';
  return `https://${normalizedDomain}/products/${trimmedHandle}`;
}

async function handleRealHandler(req, res, diagId) {
  await runWithLenientCors(req, res, async () => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const errorCode = err?.code === 'payload_too_large' ? 'payload_too_large' : 'invalid_json';
      const status = err?.code === 'payload_too_large' ? 413 : 400;
      sendJsonWithCors(req, res, status, { ok: false, error: errorCode, diagId });
      return;
    }

    const { rid, designSlug } = extractTrackingFields(body || {}, req.headers || {});
    try {
      console.info('[create-checkout]', {
        diagId,
        step: 'attach_rid',
        rid: rid || null,
        design_slug: designSlug || null,
      });
    } catch {}

    const { variantNumeric, variantGid, productHandle } = extractVariantFromBody(body || {});
    if (!variantGid) {
      sendJsonWithCors(req, res, 200, { ok: false, error: 'invalid_variant', diagId });
      return;
    }

    const quantity = parseQuantity(body?.quantity);
    const discountCodeRaw =
      typeof body?.discountCode === 'string'
        ? body.discountCode
        : typeof body?.discount === 'string'
          ? body.discount
          : '';
    const discountCode = discountCodeRaw.trim();

    let result;
    try {
      result = await callShopifyCheckoutCreate({
        variantId: variantGid,
        quantity,
        discountCode,
        rid,
        designSlug,
      });
    } catch (err) {
      if (err?.code === 'SHOPIFY_TIMEOUT') {
        throw err;
      }
      logApiError('create-checkout', { diagId, step: 'shopify_request', error: err });
      sendJsonWithCors(req, res, 200, { ok: false, error: 'checkout_error', diagId });
      return;
    }

    const domain = resolveShopDomain();

    if (!result?.ok) {
      const userErrors = Array.isArray(result?.userErrors) ? result.userErrors : [];
      const fallbackUrl =
        buildCartFallbackUrl(domain, variantNumeric, quantity, discountCode)
        || buildProductFallbackUrl(domain, productHandle);

      if (fallbackUrl) {
        const fallbackPayload = {
          ok: true,
          checkoutUrl: fallbackUrl,
          url: fallbackUrl,
          diagId,
          mode: 'fallback',
          ...(userErrors.length ? { userErrors } : {}),
          ...(result?.requestId ? { requestId: result.requestId } : {}),
        };
        sendJsonWithCors(req, res, 200, fallbackPayload);
        return;
      }

      const errorPayload = {
        ok: false,
        error: 'checkout_error',
        diagId,
        ...(userErrors.length ? { userErrors } : {}),
        ...(result?.requestId ? { requestId: result.requestId } : {}),
        ...(result?.status ? { shopifyStatus: result.status } : {}),
      };

      if (result?.type === 'graphql_errors') {
        logApiError('create-checkout', { diagId, step: 'shopify_graphql_error', error: result.errors });
        if (result?.errors) {
          errorPayload.detail = result.errors;
        }
      } else if (result?.type === 'http_error') {
        logApiError('create-checkout', {
          diagId,
          step: 'shopify_http_error',
          status: result.status,
          error: result.body,
        });
      } else if (result?.type === 'invalid_response') {
        logApiError('create-checkout', { diagId, step: 'invalid_response', error: 'invalid_json' });
      } else if (result?.type === 'missing_checkout_url') {
        logApiError('create-checkout', { diagId, step: 'missing_checkout_url' });
      }

      sendJsonWithCors(req, res, 200, errorPayload);
      return;
    }

    const payload = {
      ok: true,
      checkoutUrl: result.checkoutUrl,
      url: result.checkoutUrl,
      checkoutId: result.checkoutId || null,
      requestId: result.requestId || null,
      diagId,
    };

    sendJsonWithCors(req, res, 200, payload);
  });
}

function resolveShopDomain() {
  const candidates = [process.env.SHOPIFY_STORE_DOMAIN, process.env.SHOPIFY_SHOP];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function normalizeOrigin(origin) {
  if (typeof origin !== 'string') return '';
  const trimmed = origin.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return '';
  }
}

function isAllowedOrigin(req) {
  const originHeader = req?.headers?.origin;
  const requestOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);

  if (!normalizedRequestOrigin) {
    return false;
  }

  const normalizedAllowedOrigins = OFFICIAL_ALLOWED_ORIGINS
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  return normalizedAllowedOrigins.includes(normalizedRequestOrigin);
}

function sendForbidden(res, diagId) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  if (typeof res.status === 'function') {
    res.status(403);
  } else {
    res.statusCode = 403;
  }
  res.end(JSON.stringify({ ok: false, error: 'forbidden', diagId }));
}

function validateRealConfig(req, res, diagId) {
  const missing = collectMissingEnv(REQUIRED_ENV);
  if (missing.length) {
    logApiError('create-checkout', { diagId, step: 'missing_env', error: `missing_env:${missing.join(',')}` });
    sendJsonWithCors(req, res, 400, { ok: false, error: 'missing_env', missing, diagId });
    return false;
  }

  const domain = resolveShopDomain();
  if (!domain || !/\.myshopify\.com$/i.test(domain)) {
    logApiError('create-checkout', { diagId, step: 'invalid_shop_domain', error: domain || 'missing_domain' });
    sendJsonWithCors(req, res, 400, { ok: false, error: 'invalid_shop_domain', diagId });
    return false;
  }

  return true;
}

export default async function createCheckout(req, res) {
  const diagId = createDiagId();
  if (!isAllowedOrigin(req)) {
    sendForbidden(res, diagId);
    return;
  }

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
    const payload = buildStubCheckoutPayload();
    sendJsonWithCors(req, res, 200, { ...payload, diagId });
    return;
  }

  if (!validateRealConfig(req, res, diagId)) {
    return;
  }

  try {
    req.mgmDiagId = diagId;
    await handleRealHandler(req, res, diagId);
  } catch (err) {
    const step = err?.code === 'SHOPIFY_TIMEOUT' ? err?.step || 'shopify_request' : 'proxy_handler';
    logApiError('create-checkout', { diagId, step, error: err });
    if (!res.headersSent) {
      if (err?.code === 'SHOPIFY_TIMEOUT') {
        sendJsonWithCors(req, res, 200, {
          ok: false,
          error: 'shopify_timeout',
          diagId,
          step,
        });
        return;
      }
      sendJsonWithCors(req, res, 200, { ok: false, error: 'checkout_error', diagId });
    }
  }
}

export const createCheckoutConfig = { memory: 256, maxDuration: 60 };
