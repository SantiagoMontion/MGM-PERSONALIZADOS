import { shopifyAdmin, shopifyAdminGraphQL } from '../shopify.js';

let onlineStorePublicationIdPromise;
let cachedOnlineStorePublicationId = '';
let runtimeOnlineStorePublicationId = '';
let runtimeOnlineStorePublicationSource = '';
let runtimeOnlineStorePublicationName = '';

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

function setRuntimePublicationId(id, source = 'runtime', name = '') {
  const normalized = normalizeId(id);
  if (!normalized) return '';
  runtimeOnlineStorePublicationId = normalized;
  runtimeOnlineStorePublicationSource = source;
  runtimeOnlineStorePublicationName = typeof name === 'string' ? name : '';
  cachedOnlineStorePublicationId = normalized;
  return normalized;
}

function extractRequestId(resp) {
  if (!resp || typeof resp !== 'object' || typeof resp.headers?.get !== 'function') return '';
  const candidates = ['x-request-id', 'X-Request-ID'];
  for (const header of candidates) {
    const value = resp.headers.get(header);
    if (value) return String(value);
  }
  return '';
}

async function fetchOnlineStorePublicationId() {
  const query = `query OnlineStorePublication($first: Int = 20) {
    publications(first: $first) {
      edges {
        node {
          id
          name
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
  const graphQLErrors = Array.isArray(json?.errors) ? json.errors : [];
  const formattedGraphQLErrors = formatGraphQLErrors(graphQLErrors);
  if (graphQLErrors.length) {
    try {
      console.error('online_store_publication_query_errors', {
        errors: formattedGraphQLErrors,
      });
    } catch {}
    const accessDenied = graphQLErrors.some((err) => typeof err?.message === 'string'
      && err.message.toLowerCase().includes('access denied'));
    const missingPublication = graphQLErrors.some((err) => typeof err?.message === 'string'
      && err.message.toLowerCase().includes('publication'));
    if (accessDenied || missingPublication) {
      const scopeErr = new Error('online_store_publication_missing');
      scopeErr.errors = formattedGraphQLErrors;
      throw scopeErr;
    }
    const genericErr = new Error('online_store_publication_query_failed');
    genericErr.errors = formattedGraphQLErrors;
    throw genericErr;
  }
  const edges = Array.isArray(json?.data?.publications?.edges)
    ? json.data.publications.edges
    : [];
  const nodes = edges
    .map((edge) => edge?.node)
    .filter((node) => node && typeof node === 'object');
  try {
    console.info('online_store_publications_count', {
      total: nodes.length,
      source: 'graphql',
    });
  } catch {}
  if (!nodes.length) {
    const restResult = await fetchOnlineStorePublicationIdRest();
    if (restResult) return restResult;
    const emptyErr = new Error('online_store_publication_empty');
    emptyErr.total = 0;
    throw emptyErr;
  }
  const match = findOnlineStorePublication(nodes);
  if (match?.id) {
    const publicationId = ensurePublicationGid(match.id);
    const publicationName = typeof match.name === 'string' ? match.name : '';
    try {
      console.info('online_store_publication_selected', {
        id: publicationId,
        name: publicationName || null,
        source: 'graphql',
      });
    } catch {}
    return { id: publicationId, name: publicationName };
  }
  const restResult = await fetchOnlineStorePublicationIdRest();
  if (restResult) {
    return restResult;
  }
  try {
    console.warn('online_store_publication_missing', { total: nodes.length });
  } catch {}
  throw new Error('online_store_publication_missing');
}


function buildPublicationNameCandidates(name) {
  if (typeof name !== 'string') return [];
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return [];
  let accentless = trimmed;
  try {
    accentless = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {}
  const candidates = new Set([trimmed, accentless]);
  for (const value of Array.from(candidates)) {
    if (!value) continue;
    candidates.add(value.replace(/[^a-z0-9]+/g, ' '));
    candidates.add(value.replace(/[^a-z0-9]+/g, ''));
  }
  return Array.from(candidates);
}

function isOnlineStoreName(name) {
  const candidates = buildPublicationNameCandidates(name);
  for (const value of candidates) {
    if (!value) continue;
    if (value.includes('online store') || value.includes('onlinestore')) return true;
    if (value.includes('tienda online') || value.includes('tiendaonline')) return true;
    if (value.includes('tienda en linea') || value.includes('tiendaenlinea')) return true;
  }
  return false;
}

function findOnlineStorePublication(nodes) {
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const name = typeof node.name === 'string' ? node.name : '';
    if (isOnlineStoreName(name)) {
      return node;
    }
  }
  return null;
}

function ensurePublicationGid(value) {
  const normalized = normalizeId(value);
  if (!normalized) return '';
  if (normalized.startsWith('gid://')) return normalized;
  const numeric = extractNumericId(normalized);
  return numeric ? `gid://shopify/Publication/${numeric}` : normalized;
}

async function fetchOnlineStorePublicationIdRest() {
  try {
    const resp = await shopifyAdmin('publications.json');
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      const err = new Error(`publication_rest_fetch_failed_${resp.status}`);
      err.body = json;
      throw err;
    }
    const publications = Array.isArray(json?.publications) ? json.publications : [];
    try {
      console.info('online_store_publications_count', {
        total: publications.length,
        source: 'rest',
      });
    } catch {}
    const normalizedNodes = publications
      .map((pub) => {
        if (!pub || typeof pub !== 'object') return null;
        const id = pub.admin_graphql_api_id || pub.id;
        const name = typeof pub.name === 'string' ? pub.name : '';
        if (!id || !name) return null;
        return { id, name };
      })
      .filter(Boolean);
    const match = findOnlineStorePublication(normalizedNodes);
    if (match?.id) {
      const publicationId = ensurePublicationGid(match.id);
      const publicationName = typeof match.name === 'string' ? match.name : '';
      try {
        console.info('online_store_publication_selected', {
          id: publicationId,
          name: publicationName || null,
          source: 'rest',
        });
      } catch {}
      return { id: publicationId, name: publicationName };
    }
    return null;
  } catch (error) {
    try {
      console.error('online_store_publication_rest_error', {
        message: error?.message || String(error),
      });
    } catch {}
    return null;
  }
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
    const pending = fetchOnlineStorePublicationId().then((info) => {
      if (info && typeof info === 'object') {
        const id = normalizeId(info.id);
        setRuntimePublicationId(id, 'discovered', info.name);
        return id;
      }
      const normalized = normalizeId(info);
      if (!normalized) {
        throw new Error('online_store_publication_missing');
      }
      setRuntimePublicationId(normalized, 'discovered');
      return normalized;
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
    name: runtimeOnlineStorePublicationName || '',
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
  runtimeOnlineStorePublicationName = '';
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

function isTransientUserErrorMessage(message) {
  if (!message || typeof message !== 'string') return false;
  const normalized = message.toLowerCase();
  return normalized.includes('throttle')
    || normalized.includes('rate limit')
    || normalized.includes('temporarily unavailable')
    || normalized.includes('try again later');
}

function sanitizeUserErrorField(field) {
  if (Array.isArray(field)) {
    const segments = field
      .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
      .filter(Boolean);
    return segments.length ? segments : undefined;
  }
  if (typeof field === 'string' && field.trim()) {
    return [field.trim()];
  }
  return undefined;
}

function sanitizeUserErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((err) => {
      if (!err || typeof err !== 'object') return null;
      const message = typeof err.message === 'string' ? err.message.trim() : '';
      const field = sanitizeUserErrorField(err.field);
      if (!message && !field) return null;
      return {
        ...(field ? { field } : {}),
        ...(message ? { message } : {}),
      };
    })
    .filter(Boolean);
}

function formatGraphQLErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((err) => {
      if (!err || typeof err !== 'object') return null;
      const message = typeof err.message === 'string' ? err.message.trim() : '';
      const extensionsCode = typeof err?.extensions?.code === 'string'
        ? err.extensions.code.trim()
        : '';
      if (!message && !extensionsCode) return null;
      return {
        ...(message ? { message } : {}),
        ...(extensionsCode ? { extensionsCode } : {}),
      };
    })
    .filter(Boolean);
}

function isPublicationMissingUserError(err) {
  if (!err || typeof err !== 'object') return false;
  if (isPublicationMissingMessage(err.message)) return true;
  const fields = Array.isArray(err.field) ? err.field : [];
  return fields.some((segment) => typeof segment === 'string' && segment.toLowerCase().includes('publication'));
}

function isTransientUserError(err) {
  if (!err || typeof err !== 'object') return false;
  if (isTransientUserErrorMessage(err.message)) return true;
  const fields = Array.isArray(err.field) ? err.field : [];
  return fields.some((segment) => typeof segment === 'string' && segment.toLowerCase().includes('throttle'));
}

function isTransientGraphQLError(err) {
  if (!err || typeof err !== 'object') return false;
  if (isTransientUserErrorCode(err?.extensions?.code)) return true;
  return isTransientUserErrorMessage(err?.message);
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
      userErrors { field message }
    }
  }`;

  const maxAttempts = Math.max(1, Number.isFinite(options.maxAttempts) ? Number(options.maxAttempts) : 5);
  const initialDelay = Math.max(0, Number.isFinite(options.initialDelayMs) ? Number(options.initialDelayMs) : 200);
  const maxDelay = Math.max(initialDelay, Number.isFinite(options.maxDelayMs) ? Number(options.maxDelayMs) : 3200);

  let attempt = 0;
  let lastError;
  const requestIds = [];

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
      const requestId = extractRequestId(resp);
      if (requestId) requestIds.push(requestId);
      if (!resp.ok) {
        lastError = { reason: 'http_error', status: resp.status, body: json };
        if (isTransientStatus(resp.status) && attempt < maxAttempts) {
          retry = true;
        } else {
          try {
            console.error('publish_to_online_store_error', {
              attempt,
              publicationId,
              status: resp.status,
              requestId: requestId || null,
            });
          } catch {}
          return {
            ok: false,
            reason: 'http_error',
            status: resp.status,
            body: json,
            attempt,
            requestId: requestId || null,
            requestIds,
          };
        }
      } else {
        const graphQLErrors = Array.isArray(json?.errors) ? json.errors : [];
        if (graphQLErrors.length) {
          const formattedGraphQLErrors = formatGraphQLErrors(graphQLErrors);
          if (graphQLErrors.some((err) => isPublicationMissingMessage(err?.message)
            || isPublicationMissingCode(err?.extensions?.code))) {
            try {
              console.error('publish_to_online_store_error', {
                attempt,
                publicationId,
                requestId: requestId || null,
                reason: 'publication_missing',
                errors: formattedGraphQLErrors,
              });
            } catch {}
            return {
              ok: false,
              reason: 'publication_missing',
              errors: formattedGraphQLErrors,
              attempt,
              requestId: requestId || null,
              requestIds,
            };
          }
          lastError = { reason: 'graphql_errors', errors: formattedGraphQLErrors };
          if (graphQLErrors.some((err) => isTransientGraphQLError(err)) && attempt < maxAttempts) {
            retry = true;
          } else {
            try {
              console.error('publish_to_online_store_error', {
                attempt,
                publicationId,
                requestId: requestId || null,
                reason: 'graphql_errors',
                errors: formattedGraphQLErrors,
              });
            } catch {}
            return {
              ok: false,
              reason: 'graphql_errors',
              errors: formattedGraphQLErrors,
              attempt,
              requestId: requestId || null,
              requestIds,
            };
          }
        } else {
          const userErrors = sanitizeUserErrors(json?.data?.publishablePublish?.userErrors);
          if (userErrors.length) {
            if (userErrors.some((err) => isPublicationMissingUserError(err))) {
              try {
                console.error('publish_to_online_store_error', {
                  attempt,
                  publicationId,
                  requestId: requestId || null,
                  reason: 'publication_missing',
                  userErrors: userErrors.map((err) => ({
                    field: Array.isArray(err.field) ? err.field.join('.') : undefined,
                    message: err.message || '',
                  })),
                });
              } catch {}
              return {
                ok: false,
                reason: 'publication_missing',
                userErrors,
                attempt,
                requestId: requestId || null,
                requestIds,
              };
            }
            if (userErrors.some((err) => isTransientUserError(err)) && attempt < maxAttempts) {
              lastError = { reason: 'user_errors', userErrors };
              retry = true;
            } else {
              try {
                console.error('publish_to_online_store_error', {
                  attempt,
                  publicationId,
                  requestId: requestId || null,
                  reason: 'user_errors',
                  userErrors: userErrors.map((err) => ({
                    field: Array.isArray(err.field) ? err.field.join('.') : undefined,
                    message: err.message || '',
                  })),
                });
              } catch {}
              return {
                ok: false,
                reason: 'user_errors',
                userErrors,
                attempt,
                requestId: requestId || null,
                requestIds,
              };
            }
          } else {
            result = { ok: true, publicationId, attempt, requestId: requestId || null, requestIds };
            try {
              console.info('publish_to_online_store_success', {
                attempt,
                publicationId,
                requestId: requestId || null,
              });
            } catch {}
          }
        }
      }
    } catch (err) {
      lastError = { reason: 'exception', error: err };
      if (attempt < maxAttempts) {
        retry = true;
      } else {
        try {
          console.error('publish_to_online_store_error', {
            attempt,
            publicationId,
            reason: 'exception',
            error: err?.message || String(err),
          });
        } catch {}
        return {
          ok: false,
          reason: 'exception',
          error: err,
          attempt,
          requestIds,
        };
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
    requestIds,
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
