// /lib/shopify.js
// Requires Node 18+ (native fetch)
import { randomUUID } from 'crypto';
import { getShopifyConfig } from './config.js';

const DEFAULT_TIMEOUT_MS = 20000;

function extractGraphQlOperationName(query = '') {
  if (typeof query !== 'string') return '';
  const match = query.match(/\b(?:mutation|query)\s+(\w+)/i);
  return match ? match[1] : '';
}

function combineAbortSignals(signals = []) {
  const filtered = signals.filter((signal) => signal && typeof signal === 'object');
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(filtered);
  }
  const relay = new AbortController();
  const abortRelay = (signal) => {
    if (relay.signal.aborted) return;
    const reason = typeof signal?.reason !== 'undefined' ? signal.reason : undefined;
    relay.abort(reason);
  };
  for (const signal of filtered) {
    if (signal.aborted) {
      abortRelay(signal);
      break;
    }
    signal.addEventListener('abort', () => abortRelay(signal), { once: true });
  }
  return relay.signal;
}

async function fetchWithTimeout(url, init = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, stepName = 'shopify_request' } = {}) {
  const externalSignal = init?.signal;
  const timeoutInfo = {};
  let signal = externalSignal;

  if (typeof timeoutMs === 'number' && timeoutMs > 0 && typeof AbortController === 'function') {
    const controller = new AbortController();
    const reason = new Error('shopify_timeout');
    reason.code = 'SHOPIFY_TIMEOUT';
    reason.step = stepName;
    reason.url = url;
    const timeoutId = setTimeout(() => controller.abort(reason), timeoutMs);
    timeoutInfo.controller = controller;
    timeoutInfo.reason = reason;
    timeoutInfo.timer = timeoutId;
    signal = combineAbortSignals([externalSignal, controller.signal]) || controller.signal;
  }

  try {
    const finalInit = signal ? { ...init, signal } : { ...init };
    if (!finalInit.signal && externalSignal) {
      finalInit.signal = externalSignal;
    }
    return await fetch(url, finalInit);
  } catch (err) {
    const abortedByTimeout = Boolean(
      timeoutInfo?.controller?.signal?.aborted && timeoutInfo.controller.signal.reason === timeoutInfo.reason,
    );
    if (abortedByTimeout || err?.code === 'SHOPIFY_TIMEOUT') {
      const timeoutError = new Error('shopify_timeout');
      timeoutError.code = 'SHOPIFY_TIMEOUT';
      timeoutError.step = stepName;
      timeoutError.url = url;
      throw timeoutError;
    }
    throw err;
  } finally {
    if (timeoutInfo?.timer) {
      clearTimeout(timeoutInfo.timer);
    }
  }
}

export async function shopifyAdmin(path, init = {}, idemKey) {
  const { STORE_DOMAIN, ADMIN_TOKEN, API_VERSION } = getShopifyConfig();
  if (!STORE_DOMAIN || !ADMIN_TOKEN) {
    const e = new Error('SHOPIFY_ENV_MISSING');
    e.missing = [];
    if (!STORE_DOMAIN) e.missing.push('SHOPIFY_STORE_DOMAIN');
    if (!ADMIN_TOKEN) e.missing.push('SHOPIFY_ADMIN_TOKEN');
    throw e;
  }
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const url = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/${cleanPath}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': ADMIN_TOKEN,
    'X-Shopify-Idempotency-Key': idemKey || randomUUID(),
    ...(init.headers || {}),
  };
  const stepName = `shopify_admin:${cleanPath || 'request'}`;
  return fetchWithTimeout(url, { ...init, headers }, { stepName });
}

export async function shopifyAdminGraphQL(query, variables = {}, idemKey) {
  const { STORE_DOMAIN, ADMIN_TOKEN, API_VERSION } = getShopifyConfig();
  if (!STORE_DOMAIN || !ADMIN_TOKEN) {
    const e = new Error('SHOPIFY_ENV_MISSING');
    e.missing = [];
    if (!STORE_DOMAIN) e.missing.push('SHOPIFY_STORE_DOMAIN');
    if (!ADMIN_TOKEN) e.missing.push('SHOPIFY_ADMIN_TOKEN');
    throw e;
  }
  const apiVersion = typeof API_VERSION === 'string' && API_VERSION.trim()
    ? API_VERSION.trim()
    : '2024-07';
  const url = `https://${STORE_DOMAIN}/admin/api/${apiVersion}/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': ADMIN_TOKEN,
    'X-Shopify-Idempotency-Key': idemKey || randomUUID(),
  };
  const operation = extractGraphQlOperationName(query);
  const stepName = operation ? `shopify_admin_graphql:${operation}` : 'shopify_admin_graphql';
  return fetchWithTimeout(
    url,
    { method: 'POST', headers, body: JSON.stringify({ query, variables }) },
    { stepName },
  );
}

function buildStorefrontEndpoint(domain, apiVersion) {
  const raw = typeof domain === 'string' ? domain.trim() : '';
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = `/api/${apiVersion}/graphql.json`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export async function shopifyStorefrontGraphQL(query, variables = {}, options = {}) {
  const { STOREFRONT_TOKEN, STOREFRONT_DOMAIN, STORE_DOMAIN, API_VERSION } = getShopifyConfig();
  const token = typeof STOREFRONT_TOKEN === 'string' ? STOREFRONT_TOKEN.trim() : '';
  if (!token) {
    const err = new Error('SHOPIFY_STOREFRONT_ENV_MISSING');
    err.missing = ['SHOPIFY_STOREFRONT_TOKEN'];
    throw err;
  }
  const endpoint = buildStorefrontEndpoint(STOREFRONT_DOMAIN || STORE_DOMAIN, API_VERSION);
  if (!endpoint) {
    const err = new Error('SHOPIFY_STOREFRONT_ENV_MISSING');
    err.missing = ['SHOPIFY_STOREFRONT_DOMAIN', 'SHOPIFY_STORE_DOMAIN'];
    throw err;
  }
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Shopify-Storefront-Access-Token': token,
  };
  if (options?.buyerIp) {
    headers['Shopify-Storefront-Buyer-IP'] = options.buyerIp;
  }
  const operation = extractGraphQlOperationName(query);
  const stepName = operation ? `shopify_storefront_graphql:${operation}` : 'shopify_storefront_graphql';
  return fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    },
    { stepName },
  );
}

function pickEnv(names) {
  for (const name of names) {
    if (!name) continue;
    const raw = typeof process.env[name] === 'string' ? process.env[name].trim() : '';
    if (raw) return raw;
  }
  return '';
}

export function getShopifySalesChannel(scope = '') {
  const preferred = pickEnv([
    scope === 'cart' ? 'SHOPIFY_CART_CHANNEL' : '',
    scope === 'checkout' ? 'SHOPIFY_CHECKOUT_CHANNEL' : '',
    'SHOPIFY_SALES_CHANNEL',
  ]);
  if (preferred) return preferred;
  return 'online_store';
}

export default { shopifyAdmin, shopifyAdminGraphQL, shopifyStorefrontGraphQL };

