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
  const base = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': ADMIN_TOKEN,
    'X-Shopify-Idempotency-Key': idemKey || randomUUID(),
  };
  return fetch(base, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
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

export default { shopifyAdmin, shopifyAdminGraphQL };

