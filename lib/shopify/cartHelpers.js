import { getPublicStorefrontBase } from '../publicStorefront.js';
import { shopifyStorefrontGraphQL } from '../shopify.js';

export function normalizeVariantNumericId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

export function ensureVariantGid(preferred, fallback, numericId) {
  const candidates = [preferred, fallback];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = String(candidate).trim();
    if (raw.startsWith('gid://shopify/ProductVariant/')) return raw;
    if (raw.startsWith('gid://')) {
      // Not a variant GID but at least a GID; allow caller to decide whether to reject.
      return raw;
    }
  }
  if (numericId) {
    return `gid://shopify/ProductVariant/${numericId}`;
  }
  return '';
}

export function resolveVariantIds({ variantId, variantGid }) {
  const variantNumericId = normalizeVariantNumericId(variantId ?? variantGid);
  const ensuredGid = ensureVariantGid(variantGid, variantId, variantNumericId);
  return { variantNumericId, variantGid: ensuredGid };
}

export function buildCartPermalink(variantNumericId, quantity) {
  if (!variantNumericId) return '';
  const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
  return `https://www.mgmgamers.store/cart/${variantNumericId}:${qty}`;
}

const VARIANT_POLL_DELAYS = Array.from({ length: 10 }, (_, index) => (index + 1) * 500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const VARIANT_AVAILABILITY_QUERY = `
  query WaitVariant($id: ID!) {
    node(id: $id) {
      __typename
      ... on ProductVariant {
        id
        availableForSale
        product {
          handle
          onlineStoreUrl
        }
      }
    }
  }
`;

export async function precheckVariantAvailability(
  variantGid,
  { maxAttempts = 10, initialDelayMs = 1000 } = {},
) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid', attempts: 0 };
  }
  const boundedAttempts = Math.max(1, Math.min(50, Math.floor(maxAttempts)));
  let attempts = 0;
  let lastReason = 'unknown';
  let lastStatus;
  let lastRequestId = '';
  let lastProductHandle = '';
  let lastProductUrl = '';
  if (initialDelayMs > 0) {
    await sleep(initialDelayMs);
  }
  for (let i = 0; i < boundedAttempts; i += 1) {
    attempts += 1;
    let resp;
    try {
      resp = await shopifyStorefrontGraphQL(VARIANT_AVAILABILITY_QUERY, { id: variantGid });
    } catch (err) {
      if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
        return { ok: false, reason: 'storefront_env_missing', attempts, missing: err.missing };
      }
      throw err;
    }
    const requestId = readRequestId(resp);
    lastRequestId = requestId || lastRequestId;
    const text = await resp.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      lastReason = 'http_error';
      lastStatus = resp.status;
      continue;
    }
    if (!json || typeof json !== 'object') {
      lastReason = 'invalid_response';
      continue;
    }
    if (Array.isArray(json.errors) && json.errors.length) {
      lastReason = 'graphql_errors';
      continue;
    }
    const node = json?.data?.node;
    if (!node) {
      lastReason = 'not_found';
      continue;
    }
    const typename = typeof node.__typename === 'string' ? node.__typename : '';
    if (typename && typename !== 'ProductVariant') {
      return {
        ok: false,
        reason: 'invalid_node_type',
        typename,
        attempts,
        requestId: requestId || undefined,
      };
    }
    const availableForSale = node.availableForSale === true;
    const product = node.product && typeof node.product === 'object' ? node.product : null;
    lastProductHandle = typeof product?.handle === 'string' ? product.handle : lastProductHandle;
    lastProductUrl = typeof product?.onlineStoreUrl === 'string' ? product.onlineStoreUrl : lastProductUrl;
    try {
      console.info(`variant_poll attempt ${attempts}`, {
        availableForSale,
        requestId: requestId || null,
        variantId: variantGid,
        productHandle: product?.handle || null,
      });
    } catch {}
    if (availableForSale === true) {
      return {
        ok: true,
        available: true,
        attempts,
        requestId: requestId || undefined,
        productHandle: lastProductHandle || undefined,
        productUrl: lastProductUrl || undefined,
      };
    }
    lastReason = 'not_available';
    if (i < boundedAttempts - 1) {
      const delay = VARIANT_POLL_DELAYS[Math.min(i, VARIANT_POLL_DELAYS.length - 1)] || 500;
      await sleep(delay);
    }
  }
  return {
    ok: false,
    available: false,
    attempts,
    reason: lastReason,
    status: lastStatus,
    requestId: lastRequestId || undefined,
    productHandle: lastProductHandle || undefined,
    productUrl: lastProductUrl || undefined,
  };
}

const CART_CREATE_MUTATION = `
  mutation CartCreate($lines: [CartLineInput!]!, $attributes: [AttributeInput!], $note: String, $buyerIdentity: CartBuyerIdentityInput, $presentmentCurrencyCode: CurrencyCode) {
    cartCreate(
      input: {
        lines: $lines
        attributes: $attributes
        note: $note
        buyerIdentity: $buyerIdentity
        presentmentCurrencyCode: $presentmentCurrencyCode
      }
    ) {
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

function buildStorefrontUrls({ cartId, checkoutUrl }) {
  if (!cartId) return {};
  const token = String(cartId).split('/').pop();
  if (!token) return {};
  if (typeof checkoutUrl === 'string' && checkoutUrl.trim()) {
    try {
      const parsed = new URL(checkoutUrl);
      const origin = `${parsed.protocol}//${parsed.host}`;
      return {
        cartUrl: `${origin}/cart/c/${token}`,
        checkoutUrl,
        cartPlain: `${origin}/cart`,
        checkoutPlain: `${origin}/checkout`,
        cartToken: token,
      };
    } catch {
      // ignore parsing issues, fallback to public storefront base.
    }
  }
  const base = getPublicStorefrontBase();
  if (base) {
    const normalized = base.replace(/\/$/, '');
    return {
      cartUrl: `${normalized}/cart/c/${token}`,
      checkoutUrl,
      cartPlain: `${normalized}/cart`,
      checkoutPlain: `${normalized}/checkout`,
      cartToken: token,
    };
  }
  return { cartToken: token, checkoutUrl };
}

const DEFAULT_COUNTRY_CODE = typeof process.env.SHOPIFY_CART_COUNTRY_CODE === 'string'
  ? process.env.SHOPIFY_CART_COUNTRY_CODE.trim() || 'AR'
  : 'AR';

const DEFAULT_PRESENTMENT = (() => {
  const envValue = typeof process.env.SHOPIFY_CART_PRESENTMENT_CURRENCY === 'string'
    ? process.env.SHOPIFY_CART_PRESENTMENT_CURRENCY.trim()
    : '';
  if (envValue) return envValue;
  if (DEFAULT_COUNTRY_CODE === 'AR') return 'ARS';
  return '';
})();

function normalizeAttributeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const keyRaw = typeof entry.key === 'string' ? entry.key : typeof entry.name === 'string' ? entry.name : '';
  const key = String(keyRaw || '').trim();
  if (!key) return null;
  const valueRaw = entry.value ?? entry.val ?? entry.content ?? '';
  const value = String(valueRaw ?? '').trim();
  return {
    key: key.slice(0, 255),
    value: value.slice(0, 255),
  };
}

function collectCustomAttributes(input) {
  const out = [];
  if (Array.isArray(input)) {
    for (const entry of input) {
      const normalized = normalizeAttributeEntry(entry);
      if (normalized) out.push(normalized);
      if (out.length >= 20) break;
    }
    return out;
  }
  if (input && typeof input === 'object') {
    const entries = Object.entries(input);
    for (const [key, value] of entries) {
      const normalized = normalizeAttributeEntry({ key, value });
      if (normalized) out.push(normalized);
      if (out.length >= 20) break;
    }
  }
  return out;
}

function mergeAttributes(custom = []) {
  const seen = new Set();
  const result = [];
  const push = (key, value) => {
    const rawKey = typeof key === 'string' ? key.trim() : '';
    if (!rawKey) return;
    const normKey = rawKey.slice(0, 255);
    const dedupeKey = normKey.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const rawValue = value == null ? '' : String(value);
    result.push({ key: normKey, value: rawValue.slice(0, 255) });
  };
  push('mgm_source', 'editor');
  for (const attr of custom) {
    push(attr.key, attr.value);
    if (result.length >= 30) break;
  }
  return result;
}

export function normalizeCartNote(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.slice(0, 1000);
}

export function normalizeCartAttributes(input) {
  return mergeAttributes(collectCustomAttributes(input));
}

export async function createStorefrontCart({
  variantGid,
  quantity,
  buyerIp,
  attributes,
  note,
  countryCode = DEFAULT_COUNTRY_CODE,
}) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid' };
  }
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.max(1, Math.floor(quantity)) : 1;
  const lines = [
    {
      merchandiseId: variantGid,
      quantity: qty,
    },
  ];
  const normalizedAttributes = Array.isArray(attributes) ? attributes : [];
  const buyerIdentity = countryCode ? { countryCode } : null;
  const noteValue = normalizeCartNote(note);
  let resp;
  try {
    resp = await shopifyStorefrontGraphQL(
      CART_CREATE_MUTATION,
      {
        lines,
        attributes: normalizedAttributes.length ? normalizedAttributes : null,
        note: noteValue || null,
        buyerIdentity,
        presentmentCurrencyCode: DEFAULT_PRESENTMENT || null,
      },
      buyerIp ? { buyerIp } : {},
    );
  } catch (err) {
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return { ok: false, reason: 'storefront_env_missing', missing: err.missing };
    }
    throw err;
  }
  const requestId = readRequestId(resp);
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    return { ok: false, reason: 'http_error', status: resp.status, body: text?.slice(0, 2000), requestId };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId };
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'graphql_errors', errors: json.errors, requestId };
  }
  const cartCreate = json?.data?.cartCreate;
  if (!cartCreate || typeof cartCreate !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId };
  }
  const userErrors = Array.isArray(cartCreate.userErrors)
    ? cartCreate.userErrors
        .map((err) => {
          if (!err || typeof err !== 'object') return null;
          const message = typeof err.message === 'string' ? err.message.trim() : '';
          if (!message) return null;
          const code = typeof err.code === 'string' ? err.code : undefined;
          const field = Array.isArray(err.field) ? err.field.map((item) => String(item)).filter(Boolean) : undefined;
          return { message, ...(code ? { code } : {}), ...(field && field.length ? { field } : {}) };
        })
        .filter(Boolean)
    : [];
  if (userErrors.length) {
    return { ok: false, reason: 'user_errors', userErrors, requestId };
  }
  const cart = cartCreate.cart;
  if (!cart || typeof cart !== 'object' || !cart.id) {
    return { ok: false, reason: 'missing_cart', requestId };
  }
  const urls = buildStorefrontUrls({ cartId: cart.id, checkoutUrl: cart.checkoutUrl });
  if (!urls.cartUrl) {
    return { ok: false, reason: 'missing_cart_url', requestId };
  }
  return {
    ok: true,
    cartUrl: urls.cartUrl,
    checkoutUrl: urls.checkoutUrl,
    cartId: cart.id,
    cartToken: urls.cartToken,
    cartPlain: urls.cartPlain,
    checkoutPlain: urls.checkoutPlain,
    requestId,
  };
}

export { VARIANT_POLL_DELAYS };
