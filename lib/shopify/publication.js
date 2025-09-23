import { shopifyAdminGraphQL } from '../shopify.js';

let onlineStorePublicationIdPromise;
let cachedOnlineStorePublicationId = '';
let runtimeOnlineStorePublicationId = '';
let runtimeOnlineStorePublicationSource = '';

function normalizeId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw;
}

function extractNumericId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureProductGid(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('gid://')) return raw;
  const numeric = extractNumericId(raw);
  if (!numeric) return '';
  return `gid://shopify/Product/${numeric}`;
}

export function ensureVariantGid(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('gid://')) return raw;
  const numeric = extractNumericId(raw);
  if (!numeric) return '';
  return `gid://shopify/ProductVariant/${numeric}`;
}

function getPublicationIdFromEnv() {
  const raw = normalizeId(process.env.SHOPIFY_PUBLICATION_ID);
  if (!raw) return '';
  return raw;
}

function setRuntimePublicationId(id, source = 'runtime') {
  const normalized = normalizeId(id);
  if (!normalized) return '';
  runtimeOnlineStorePublicationId = normalized;
  runtimeOnlineStorePublicationSource = source;
  cachedOnlineStorePublicationId = normalized;
  return normalized;
}

async function fetchOnlineStorePublicationId() {
  const query = `query OnlineStorePublication($first: Int = 20) {
    publications(first: $first) {
      edges {
        node {
          id
          name
          channel { handle }
          channelDefinition { handle }
        }
      }
    }
  }`;
  const resp = await shopifyAdminGraphQL(query, { first: 20 });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(`publication_fetch_failed_${resp.status}`);
    err.body = json;
    throw err;
  }
  const edges = Array.isArray(json?.data?.publications?.edges)
    ? json.data.publications.edges
    : [];
  const nodes = edges
    .map((edge) => edge?.node)
    .filter((node) => node && typeof node === 'object');
  const match = nodes.find((node) => {
    const handle = normalizeId(node?.channel?.handle)
      || normalizeId(node?.channelDefinition?.handle);
    if (handle && handle.toLowerCase() === 'online_store') return true;
    const name = typeof node?.name === 'string' ? node.name.toLowerCase() : '';
    if (!name) return false;
    return name.includes('online store');
  });
  if (!match?.id) {
    throw new Error('online_store_publication_missing');
  }
  return String(match.id);
}

async function resolvePublicationIdInternal(options = {}) {
  const { forceDiscover = false, preferEnv = true } = options;
  if (!forceDiscover && runtimeOnlineStorePublicationId) {
    return {
      id: runtimeOnlineStorePublicationId,
      source: runtimeOnlineStorePublicationSource || 'runtime',
    };
  }
  if (!forceDiscover && preferEnv) {
    const envId = getPublicationIdFromEnv();
    if (envId) {
      return { id: envId, source: 'env' };
    }
  }
  if (!forceDiscover && cachedOnlineStorePublicationId) {
    return {
      id: cachedOnlineStorePublicationId,
      source: runtimeOnlineStorePublicationSource || 'cache',
    };
  }

  if (forceDiscover) {
    onlineStorePublicationIdPromise = undefined;
    cachedOnlineStorePublicationId = '';
    runtimeOnlineStorePublicationId = '';
    runtimeOnlineStorePublicationSource = '';
  }

  if (!onlineStorePublicationIdPromise) {
    const pending = fetchOnlineStorePublicationId().then((id) => {
      setRuntimePublicationId(id, 'discovered');
      return id;
    });
    onlineStorePublicationIdPromise = pending.catch((err) => {
      if (onlineStorePublicationIdPromise === pending) {
        onlineStorePublicationIdPromise = undefined;
      }
      throw err;
    });
  }

  const id = await onlineStorePublicationIdPromise;
  return {
    id,
    source: runtimeOnlineStorePublicationSource || 'discovered',
  };
}

export async function resolveOnlineStorePublicationId(options = {}) {
  return resolvePublicationIdInternal(options);
}

export async function getOnlineStorePublicationId(options = {}) {
  const result = await resolvePublicationIdInternal(options);
  return result?.id || '';
}

export function overrideOnlineStorePublicationId(id, source = 'override') {
  return setRuntimePublicationId(id, source);
}

export function resetCachedPublicationId() {
  onlineStorePublicationIdPromise = undefined;
  cachedOnlineStorePublicationId = '';
  runtimeOnlineStorePublicationId = '';
  runtimeOnlineStorePublicationSource = '';
}

function isPublicationMissingMessage(message) {
  if (!message || typeof message !== 'string') return false;
  const normalized = message.toLowerCase();
  if (!normalized.includes('publication')) return false;
  return normalized.includes('missing') || normalized.includes('not found') || normalized.includes('invalid');
}

function isPublicationMissingCode(code) {
  if (!code) return false;
  const normalized = String(code).toLowerCase();
  return normalized.includes('publication');
}

function isTransientUserErrorCode(code) {
  if (!code) return false;
  const normalized = String(code).toUpperCase();
  return ['THROTTLED', 'THROTTLED_DURING_CHECKOUT', 'THROTTLED_THIRD_PARTY_APP', 'THROTTLED_APP', 'INTERNAL_SERVER_ERROR']
    .includes(normalized);
}

function isTransientStatus(status) {
  return status === 429 || status >= 500;
}

export async function publishToOnlineStore(productGid, publicationIdOverride, options = {}) {
  const publishableId = ensureProductGid(productGid);
  if (!publishableId) {
    return { ok: false, reason: 'invalid_product', attempt: 0 };
  }

  const basePublicationId = normalizeId(publicationIdOverride);
  const { preferEnv = true } = options;
  const publicationInfo = basePublicationId
    ? { id: basePublicationId, source: 'override' }
    : await resolvePublicationIdInternal({ preferEnv });
  const publicationId = publicationInfo?.id ? normalizeId(publicationInfo.id) : '';
  if (!publicationId) {
    return { ok: false, reason: 'publication_missing', attempt: 0 };
  }

  const mutation = `mutation PublishProduct($publishableId: ID!, $publicationId: ID!) {
    publishablePublish(publishableId: $publishableId, input: [{ publicationId: $publicationId }]) {
      userErrors { code message field }
    }
  }`;

  const maxAttempts = Math.max(1, Number.isFinite(options.maxAttempts) ? Number(options.maxAttempts) : 5);
  const initialDelay = Math.max(0, Number.isFinite(options.initialDelayMs) ? Number(options.initialDelayMs) : 200);
  const maxDelay = Math.max(initialDelay, Number.isFinite(options.maxDelayMs) ? Number(options.maxDelayMs) : 800);

  let attempt = 0;
  let lastError;

  while (attempt < maxAttempts) {
    attempt += 1;
    let retry = false;
    let result;

    try {
      console.info('publish_to_online_store_attempt', { attempt, publicationId });
    } catch {}

    try {
      const resp = await shopifyAdminGraphQL(mutation, {
        publishableId,
        publicationId,
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        lastError = { reason: 'http_error', status: resp.status, body: json };
        if (isTransientStatus(resp.status) && attempt < maxAttempts) {
          retry = true;
        } else {
          return { ok: false, reason: 'http_error', status: resp.status, body: json, attempt };
        }
      } else {
        const graphQLErrors = Array.isArray(json?.errors) ? json.errors : [];
        if (graphQLErrors.length) {
          if (graphQLErrors.some((err) => isPublicationMissingMessage(err?.message)
            || isPublicationMissingCode(err?.extensions?.code))) {
            return { ok: false, reason: 'publication_missing', errors: graphQLErrors, attempt };
          }
          lastError = { reason: 'graphql_errors', errors: graphQLErrors };
          if (graphQLErrors.some((err) => isTransientUserErrorCode(err?.extensions?.code)) && attempt < maxAttempts) {
            retry = true;
          } else {
            return { ok: false, reason: 'graphql_errors', errors: graphQLErrors, attempt };
          }
        } else {
          const userErrors = Array.isArray(json?.data?.publishablePublish?.userErrors)
            ? json.data.publishablePublish.userErrors.filter((err) => err && (err.message || err.code))
            : [];
          if (userErrors.length) {
            if (userErrors.some((err) => isPublicationMissingMessage(err?.message)
              || isPublicationMissingCode(err?.code))) {
              return { ok: false, reason: 'publication_missing', userErrors, attempt };
            }
            if (userErrors.some((err) => isTransientUserErrorCode(err?.code)) && attempt < maxAttempts) {
              lastError = { reason: 'user_errors', userErrors };
              retry = true;
            } else {
              return { ok: false, reason: 'user_errors', userErrors, attempt };
            }
          } else {
            result = { ok: true, publicationId, attempt };
          }
        }
      }
    } catch (err) {
      lastError = { reason: 'exception', error: err };
      if (attempt < maxAttempts) {
        retry = true;
      } else {
        return { ok: false, reason: 'exception', error: err, attempt };
      }
    }

    if (result) {
      return result;
    }

    if (!retry) break;

    const delay = Math.min(initialDelay * (2 ** Math.max(0, attempt - 1)), maxDelay);
    await sleep(delay);
  }

  return {
    ok: false,
    reason: lastError?.reason || 'publish_failed',
    error: lastError,
    attempt,
  };
}

export default {
  ensureProductGid,
  ensureVariantGid,
  getOnlineStorePublicationId,
  resolveOnlineStorePublicationId,
  overrideOnlineStorePublicationId,
  publishToOnlineStore,
  resetCachedPublicationId,
};
