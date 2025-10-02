export function getEnv(name, { required = true } = {}) {
  const v = process.env[name];
  if ((v == null || v === '') && required) {
    const err = new Error(`ENV_MISSING:${name}`);
    err.name = 'ENV_MISSING';
    err.env = name;
    throw err;
  }
  return v ?? '';
}

function pickEnv(names) {
  for (const name of names) {
    if (!name) continue;
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function getShopifyConfig() {
  const rawDomain = pickEnv([
    'SHOPIFY_STORE_DOMAIN',
    'SHOPIFY_SHOP',
    'SHOPIFY_DOMAIN',
    'VITE_SHOPIFY_DOMAIN',
    'VITE_SHOPIFY_STORE_DOMAIN',
  ]);

  if (!process.env.SHOPIFY_STORE_DOMAIN && rawDomain) {
    process.env.SHOPIFY_STORE_DOMAIN = rawDomain;
  }

  const apiVersion = pickEnv(['SHOPIFY_API_VERSION', 'VITE_SHOPIFY_API_VERSION']) || '2024-07';

  const storefrontDomain = pickEnv([
    'SHOPIFY_STOREFRONT_DOMAIN',
    'VITE_SHOPIFY_STOREFRONT_DOMAIN',
    rawDomain ? null : 'VITE_SHOPIFY_DOMAIN',
  ].filter(Boolean));

  const storefrontToken = pickEnv(['SHOPIFY_STOREFRONT_TOKEN', 'VITE_SHOPIFY_STOREFRONT_TOKEN']);

  return {
    STORE_DOMAIN: rawDomain,
    ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN || '',
    API_VERSION: apiVersion,
    STOREFRONT_TOKEN: storefrontToken,
    STOREFRONT_DOMAIN: storefrontDomain || rawDomain,
  };
}

export default { getEnv, getShopifyConfig };

