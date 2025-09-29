import { shopifyAdminGraphQL, shopifyStorefrontGraphQL } from '../shopify.js';

const STORE_ORIGIN = (process.env.SHOPIFY_CART_ORIGIN || 'https://www.mgmgamers.store').replace(/\/+$/, '');
const FALLBACK_ADD_ENDPOINT = `${STORE_ORIGIN}/cart/add.js`;
const FALLBACK_CART_URL = `${STORE_ORIGIN}/cart`;
const DEFAULT_CART_ORIGIN = STORE_ORIGIN;
const DEFAULT_VARIANT_AVAILABILITY_BACKOFF_MS = [
  1500,
  2500,
  4000,
  6000,
  9000,
  13000,
  20000,
  30000,
  45000,
  60000,
];

const CART_CREATE_MUTATION = `
  mutation CartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const CART_LINES_ADD_MUTATION = `
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const VARIANT_PRODUCT_HANDLE_QUERY = `
  query VariantProductHandle($id: ID!) {
    productVariant(id: $id) {
      id
      product {
        id
        handle
        onlineStoreUrl
      }
    }
  }
`;

const PRODUCT_VARIANT_AVAILABILITY_QUERY = `
  query ProductVariantAvailability($handle: String!) {
    product(handle: $handle) {
      id
      handle
      onlineStoreUrl
      variants(first: 250) {
        nodes {
          id
          availableForSale
        }
      }
    }
  }
`;

function buildFallbackPermalink(variantNumericId, quantity) {
  const id = variantNumericId ? String(variantNumericId).trim() : '';
  if (!id) return FALLBACK_CART_URL;
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.max(1, Math.floor(quantity)) : 1;
  return `${FALLBACK_CART_URL}/${id}:${qty}`;
}

function buildStorefrontCartUrls({ cartId, checkoutUrl }) {
  const token = typeof cartId === 'string' ? cartId.split('/').pop() : '';
  const checkoutRaw = typeof checkoutUrl === 'string' ? checkoutUrl.trim() : '';
  let origin = '';
  if (checkoutRaw) {
    try {
      const parsed = new URL(checkoutRaw);
      origin = `${parsed.protocol}//${parsed.host}`;
    } catch {}
  }
  if (!origin) {
    origin = DEFAULT_CART_ORIGIN;
  }
  const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : '';
  const cartUrl = normalizedOrigin && token ? `${normalizedOrigin}/cart/c/${token}` : '';
  return {
    cartUrl,
    checkoutUrl: checkoutRaw,
    cartPlain: normalizedOrigin ? `${normalizedOrigin}/cart` : '',
    checkoutPlain: normalizedOrigin ? `${normalizedOrigin}/checkout` : '',
    cartToken: token || '',
  };
}

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

function readSetCookies(resp) {
  if (!resp?.headers) return [];
  if (typeof resp.headers.getSetCookie === 'function') {
    const values = resp.headers.getSetCookie();
    if (Array.isArray(values)) return values;
  }
  const single = resp.headers.get?.('set-cookie');
  if (!single) return [];
  if (Array.isArray(single)) return single;
  return [single];
}

async function fetchVariantProductHandle(variantGid) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid' };
  }
  let resp;
  try {
    resp = await shopifyAdminGraphQL(VARIANT_PRODUCT_HANDLE_QUERY, { id: variantGid });
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return { ok: false, reason: 'admin_env_missing', missing: err.missing };
    }
    throw err;
  }
  const requestId = readRequestId(resp);
  const contentType = (resp.headers?.get?.('content-type') || '').toLowerCase();
  const text = await resp.text();
  let json;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      try {
        console.error('[storefront_cart] admin_variant_handle_parse_failed', {
          message: err?.message,
          contentType,
          preview: text.slice(0, 200),
          requestId,
        });
      } catch {}
      return { ok: false, reason: 'admin_invalid_response', requestId };
    }
  }
  if (!resp.ok) {
    try {
      console.error('[storefront_cart] admin_variant_handle_http_error', {
        status: resp.status,
        contentType,
        bodyPreview: text ? text.slice(0, 200) : '',
        requestId,
      });
    } catch {}
    return {
      ok: false,
      reason: 'admin_http_error',
      status: resp.status,
      requestId,
      body: text ? text.slice(0, 2000) : '',
    };
  }
  const variant = json?.data?.productVariant;
  const product = variant?.product && typeof variant.product === 'object' ? variant.product : null;
  const handle = typeof product?.handle === 'string' ? product.handle.trim() : '';
  const onlineStoreUrl = typeof product?.onlineStoreUrl === 'string' ? product.onlineStoreUrl : '';
  const summary = buildVariantAvailabilitySummary(variant, {
    handle,
    onlineStoreUrl,
  });
  if (!variant || typeof variant !== 'object') {
    return {
      ok: false,
      reason: 'variant_not_found_in_admin',
      requestId,
      availability: summary,
    };
  }
  if (!handle) {
    return {
      ok: false,
      reason: 'missing_product_handle',
      requestId,
      availability: summary,
    };
  }
  return {
    ok: true,
    handle,
    productId: typeof product?.id === 'string' ? product.id : '',
    productOnlineStoreUrl: onlineStoreUrl,
    variantId: typeof variant.id === 'string' ? variant.id : '',
    availability: summary,
    requestId,
  };
}

class SimpleCookieJar {
  constructor() {
    this.cookies = new Map();
  }

  storeFromResponse(resp) {
    const setCookies = readSetCookies(resp);
    for (const raw of setCookies) {
      if (typeof raw !== 'string') continue;
      const [pair] = raw.split(';', 1);
      if (!pair) continue;
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }

  get headerValue() {
    const parts = [];
    for (const [name, value] of this.cookies.entries()) {
      if (!name) continue;
      parts.push(`${name}=${value ?? ''}`);
    }
    return parts.join('; ');
  }

  get(name) {
    if (!name) return '';
    const value = this.cookies.get(name);
    return typeof value === 'string' ? value : '';
  }
}

function buildLines(variantGid, quantity) {
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.max(1, Math.floor(quantity)) : 1;
  return [
    {
      merchandiseId: variantGid,
      quantity: qty,
    },
  ];
}

async function executeStorefrontMutation(query, variables, { buyerIp } = {}) {
  let resp;
  try {
    resp = await shopifyStorefrontGraphQL(query, variables, buyerIp ? { buyerIp } : {});
  } catch (err) {
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return { ok: false, reason: 'storefront_env_missing', missing: err.missing };
    }
    throw err;
  }
  const requestId = readRequestId(resp);
  const contentType = (resp.headers?.get?.('content-type') || '').toLowerCase();
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    try {
      console.error('[storefront_cart] storefront_response_parse_failed', {
        status: resp.status,
        contentType,
        bodyPreview: text ? text.slice(0, 200) : '',
        requestId,
      });
    } catch {}
    json = null;
  }
  if (!resp.ok) {
    try {
      console.error('[storefront_cart] storefront_http_error', {
        status: resp.status,
        contentType,
        bodyPreview: text ? text.slice(0, 200) : '',
        requestId,
      });
    } catch {}
    return {
      ok: false,
      reason: 'http_error',
      status: resp.status,
      body: text ? text.slice(0, 2000) : '',
      requestId,
    };
  }
  if (!json || typeof json !== 'object') {
    try {
      console.error('[storefront_cart] storefront_invalid_response', {
        status: resp.status,
        contentType,
        bodyPreview: text ? text.slice(0, 200) : '',
        requestId,
      });
    } catch {}
    return { ok: false, reason: 'invalid_response', requestId };
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'graphql_errors', errors: json.errors, requestId };
  }
  return { ok: true, json, requestId };
}

function buildVariantAvailabilitySummary(variant, productInfo = {}) {
  if (!variant || typeof variant !== 'object') {
    return {
      exists: false,
      productHandle: typeof productInfo?.handle === 'string' ? productInfo.handle : '',
      productOnlineStoreUrl: typeof productInfo?.onlineStoreUrl === 'string'
        ? productInfo.onlineStoreUrl
        : '',
    };
  }
  const product = variant.product && typeof variant.product === 'object' ? variant.product : null;
  const infoHandle = typeof productInfo?.handle === 'string' ? productInfo.handle : '';
  const infoUrl = typeof productInfo?.onlineStoreUrl === 'string' ? productInfo.onlineStoreUrl : '';
  return {
    exists: true,
    availableForSale: Boolean(variant.availableForSale),
    variantId: typeof variant.id === 'string' ? variant.id : '',
    productHandle: infoHandle || (typeof product?.handle === 'string' ? product.handle : ''),
    productOnlineStoreUrl: infoUrl || (typeof product?.onlineStoreUrl === 'string' ? product.onlineStoreUrl : ''),
  };
}

async function wait(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForVariantAvailability({
  variantGid,
  buyerIp,
  attempts = 0,
  delayMs = 2000,
  initialDelayMs = 0,
  backoffMs = null,
  productHandle: knownProductHandle = '',
  productOnlineStoreUrl: knownProductOnlineStoreUrl = '',
} = {}) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid' };
  }

  let productHandle = typeof knownProductHandle === 'string' ? knownProductHandle.trim() : '';
  let productOnlineStoreUrl = typeof knownProductOnlineStoreUrl === 'string'
    ? knownProductOnlineStoreUrl
    : '';
  let adminRequestId = null;
  let lastSummary = null;

  if (!productHandle) {
    const handleResult = await fetchVariantProductHandle(variantGid);
    if (!handleResult.ok) {
      return {
        ok: false,
        reason: handleResult.reason || 'variant_not_ready',
        availability: handleResult.availability || undefined,
        requestId: handleResult.requestId || undefined,
        ...(handleResult.missing ? { missing: handleResult.missing } : {}),
      };
    }
    productHandle = handleResult.handle;
    if (handleResult.productOnlineStoreUrl) {
      productOnlineStoreUrl = handleResult.productOnlineStoreUrl;
    }
    adminRequestId = handleResult.requestId || null;
    if (handleResult.availability) {
      lastSummary = handleResult.availability;
    }
  }

  const normalizedBackoff = Array.isArray(backoffMs) && backoffMs.length
    ? backoffMs.map((ms) => (Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0))
    : [...DEFAULT_VARIANT_AVAILABILITY_BACKOFF_MS];
  const normalizedDelay = Number.isFinite(delayMs) && delayMs > 0 ? Math.floor(delayMs) : 2000;
  if (!normalizedBackoff.length) {
    normalizedBackoff.push(normalizedDelay);
  }
  const maxAttempts = Number.isFinite(attempts) && attempts > 0
    ? Math.floor(attempts)
    : normalizedBackoff.length + 1;

  let lastError = null;
  let lastRequestId = adminRequestId || null;

  if (Number.isFinite(initialDelayMs) && initialDelayMs > 0) {
    await wait(Math.max(0, Math.floor(initialDelayMs)));
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await executeStorefrontMutation(
      PRODUCT_VARIANT_AVAILABILITY_QUERY,
      { handle: productHandle },
      buyerIp ? { buyerIp } : {},
    );
    if (result.requestId) {
      lastRequestId = result.requestId;
    }
    if (!result.ok) {
      if (result.reason === 'storefront_env_missing') {
        return result;
      }
      lastError = result;
    } else {
      const product = result.json?.data?.product;
      const variantsSource = product?.variants;
      const nodes = Array.isArray(variantsSource?.nodes)
        ? variantsSource.nodes
        : Array.isArray(variantsSource?.edges)
          ? variantsSource.edges.map((edge) => edge?.node).filter(Boolean)
          : [];
      const match = nodes.find((variant) => variant?.id === variantGid);
      const summary = buildVariantAvailabilitySummary(match, {
        handle: productHandle,
        onlineStoreUrl:
          typeof product?.onlineStoreUrl === 'string' && product.onlineStoreUrl
            ? product.onlineStoreUrl
            : productOnlineStoreUrl,
      });
      if (!summary.productOnlineStoreUrl && productOnlineStoreUrl) {
        summary.productOnlineStoreUrl = productOnlineStoreUrl;
      }
      lastSummary = summary;
      if (
        summary.exists &&
        summary.variantId === variantGid &&
        summary.availableForSale === true
      ) {
        return {
          ok: true,
          attempts: attempt + 1,
          availability: summary,
          requestId: result.requestId || lastRequestId || adminRequestId || undefined,
        };
      }
    }
    if (attempt < maxAttempts - 1) {
      const waitMs = normalizedBackoff[Math.min(attempt, normalizedBackoff.length - 1)] || 0;
      if (waitMs > 0) {
        await wait(waitMs);
      }
    }
  }
  return {
    ok: false,
    reason: 'variant_not_ready',
    attempts: maxAttempts,
    availability: lastSummary || undefined,
    lastError: lastError || undefined,
    requestId: lastError?.requestId || lastRequestId || adminRequestId || undefined,
  };
}

function normalizeUserErrors(rawErrors) {
  if (!Array.isArray(rawErrors)) return [];
  return rawErrors
    .map((err) => {
      if (!err || typeof err !== 'object') return null;
      const message = typeof err.message === 'string' ? err.message.trim() : '';
      if (!message) return null;
      const code = typeof err.code === 'string' ? err.code : undefined;
      const field = Array.isArray(err.field)
        ? err.field.map((item) => String(item)).filter(Boolean)
        : undefined;
      return {
        message,
        ...(code ? { code } : {}),
        ...(field && field.length ? { field } : {}),
      };
    })
    .filter(Boolean);
}

export async function createStorefrontCartServer({ variantGid, quantity, buyerIp }) {
  const lines = buildLines(variantGid, quantity);
  const result = await executeStorefrontMutation(
    CART_CREATE_MUTATION,
    { lines },
    buyerIp ? { buyerIp } : {},
  );
  if (!result.ok) {
    return result;
  }
  const payload = result.json?.data?.cartCreate;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId: result.requestId };
  }
  const userErrors = normalizeUserErrors(payload.userErrors);
  if (userErrors.length) {
    return { ok: false, reason: 'user_errors', userErrors, requestId: result.requestId };
  }
  const cart = payload.cart;
  const checkoutUrl = typeof cart?.checkoutUrl === 'string' ? cart.checkoutUrl.trim() : '';
  if (!cart || typeof cart !== 'object' || !cart.id || !checkoutUrl) {
    return { ok: false, reason: 'missing_cart', requestId: result.requestId };
  }
  const urls = buildStorefrontCartUrls({ cartId: cart.id, checkoutUrl });
  return {
    ok: true,
    cartId: cart.id,
    cartUrl: urls.cartUrl || '',
    cartPlain: urls.cartPlain || '',
    cartToken: urls.cartToken || '',
    checkoutUrl: urls.checkoutUrl || '',
    checkoutPlain: urls.checkoutPlain || '',
    cartWebUrl: urls.cartUrl || '',
    requestId: result.requestId,
  };
}

export async function addLinesToStorefrontCart({ cartId, variantGid, quantity, buyerIp }) {
  if (!cartId) {
    return { ok: false, reason: 'missing_cart_id' };
  }
  const lines = buildLines(variantGid, quantity);
  const result = await executeStorefrontMutation(
    CART_LINES_ADD_MUTATION,
    { cartId, lines },
    buyerIp ? { buyerIp } : {},
  );
  if (!result.ok) {
    return result;
  }
  const payload = result.json?.data?.cartLinesAdd;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId: result.requestId };
  }
  const userErrors = normalizeUserErrors(payload.userErrors);
  if (userErrors.length) {
    return { ok: false, reason: 'user_errors', userErrors, requestId: result.requestId };
  }
  const cart = payload.cart;
  const checkoutUrl = typeof cart?.checkoutUrl === 'string' ? cart.checkoutUrl.trim() : '';
  if (!cart || typeof cart !== 'object' || !cart.id || !checkoutUrl) {
    return { ok: false, reason: 'missing_cart', requestId: result.requestId };
  }
  const urls = buildStorefrontCartUrls({ cartId: cart.id, checkoutUrl });
  return {
    ok: true,
    cartId: cart.id,
    cartUrl: urls.cartUrl || '',
    cartPlain: urls.cartPlain || '',
    cartToken: urls.cartToken || '',
    checkoutUrl: urls.checkoutUrl || '',
    checkoutPlain: urls.checkoutPlain || '',
    cartWebUrl: urls.cartUrl || '',
    requestId: result.requestId,
  };
}

export async function fallbackCartAdd({ variantNumericId, quantity, jar = new SimpleCookieJar() }) {
  const normalizedId = typeof variantNumericId === 'string'
    ? variantNumericId.trim()
    : String(variantNumericId || '').trim();
  if (!normalizedId) {
    return { ok: false, reason: 'missing_variant_id' };
  }
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.max(1, Math.floor(quantity)) : 1;
  const itemId = Number.isFinite(Number(normalizedId)) ? Number(normalizedId) : normalizedId;
  const payload = {
    items: [
      {
        id: itemId,
        quantity: qty,
        properties: {},
      },
    ],
  };
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/javascript, */*;q=0.01',
    'User-Agent': 'mgm-cart/1.0 (+https://www.mgmgamers.store)',
  };
  const cookieHeader = jar.headerValue;
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  try {
    console.info('ajax_cart_attempt', {
      endpoint: FALLBACK_ADD_ENDPOINT,
      variantNumericId: normalizedId,
      quantity: qty,
    });
  } catch {}
  const resp = await fetch(FALLBACK_ADD_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    redirect: 'manual',
  });
  jar.storeFromResponse(resp);
  const contentType = (resp.headers?.get?.('content-type') || '').toLowerCase();
  const text = await resp.text();
  let json;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      json = null;
      try {
        console.warn('[storefront_cart] ajax_cart_parse_failed', {
          message: err?.message,
          preview: text.slice(0, 200),
        });
      } catch {}
    }
  }
  if (!resp.ok) {
    const detail = json ? JSON.stringify(json).slice(0, 2000) : text ? text.slice(0, 2000) : '';
    try {
      console.error('[storefront_cart] ajax_cart_http_error', {
        status: resp.status,
        contentType,
        bodyPreview: text ? text.slice(0, 200) : '',
        payload,
        detail,
      });
    } catch {}
    return {
      ok: false,
      reason: 'ajax_cart_failed',
      status: resp.status,
      detail,
    };
  }
  let token = typeof json?.token === 'string' ? json.token.trim() : '';
  const items = Array.isArray(json?.items) ? json.items : [];
  const matchedItem = items.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const variantId =
      item.variant_id !== undefined
        ? String(item.variant_id)
        : item.id !== undefined
          ? String(item.id)
          : '';
    return variantId && variantId === String(itemId);
  });
  const detail = json ? JSON.stringify(json).slice(0, 2000) : text ? text.slice(0, 2000) : '';
  if (!matchedItem) {
    try {
      console.error('[storefront_cart] ajax_cart_silent_failure', {
        status: resp.status,
        contentType,
        payload,
        detail,
        hasToken: Boolean(token),
        matchedItem: Boolean(matchedItem),
      });
    } catch {}
    return {
      ok: false,
      reason: 'ajax_cart_silent_failure',
      detail,
      status: resp.status,
    };
  }
  if (!token) {
    const cookieToken = jar.get('cart');
    if (cookieToken) {
      token = cookieToken.trim();
    }
  }
  const cartUrl = token ? `${DEFAULT_CART_ORIGIN}/cart/c/${token}` : FALLBACK_CART_URL;
  try {
    console.info('[storefront_cart] ajax_cart_success', {
      status: resp.status,
      contentType,
      cartUrl,
      token: token ? `${token.slice(0, 6)}…` : '',
      matchedItem: true,
    });
  } catch {}
  return {
    ok: true,
    cartUrl,
    cartWebUrl: cartUrl,
    fallbackCartUrl: FALLBACK_CART_URL,
    detail,
    responseJson: json || undefined,
    matchedItem: true,
    cartToken: token || '',
  };
}

export { SimpleCookieJar };
