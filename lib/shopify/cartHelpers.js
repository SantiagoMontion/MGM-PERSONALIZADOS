import { shopifyStorefrontGraphQL } from '../shopify.js';
import { idVariantGidToNumeric } from '../utils/shopifyIds.js';
import { buildOnlineStoreCartPermalink } from '../utils/permalink.js';

export function normalizeVariantNumericId(value) {
  if (value == null) return '';
  try {
    return idVariantGidToNumeric(value);
  } catch {
    return '';
  }
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

export function buildCartPermalink(variantNumericId, quantity, { discountCode } = {}) {
  let numericId;
  try {
    numericId = idVariantGidToNumeric(variantNumericId);
  } catch (err) {
    try {
      console.warn('build_cart_permalink_invalid_id', {
        message: err?.message || String(err),
        variantNumericId: variantNumericId ?? null,
      });
    } catch {}
    return '';
  }
  if (!/^\d+$/.test(String(numericId || ''))) {
    return '';
  }
  return buildOnlineStoreCartPermalink(numericId, quantity, discountCode);
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

export { VARIANT_POLL_DELAYS };
