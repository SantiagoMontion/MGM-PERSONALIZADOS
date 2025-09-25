// /lib/shopify.js
// Requires Node 18+ (native fetch)
import { randomUUID } from 'crypto';
import { getShopifyConfig } from './config.js';

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
  return fetch(url, { ...init, headers });
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
  return fetch(url, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
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
  return fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
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

