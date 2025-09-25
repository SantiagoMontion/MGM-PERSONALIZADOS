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

export function getShopifyConfig() {
  const rawDomain = [process.env.SHOPIFY_STORE_DOMAIN, process.env.SHOPIFY_SHOP]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value) || '';
  if (!process.env.SHOPIFY_STORE_DOMAIN && rawDomain) {
    process.env.SHOPIFY_STORE_DOMAIN = rawDomain;
  }
  const apiVersion = typeof process.env.SHOPIFY_API_VERSION === 'string'
    ? process.env.SHOPIFY_API_VERSION.trim() || '2024-07'
    : '2024-07';
  return {
    STORE_DOMAIN: rawDomain,
    ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN || '',
    API_VERSION: apiVersion,
    STOREFRONT_TOKEN: process.env.SHOPIFY_STOREFRONT_TOKEN || '',
    STOREFRONT_DOMAIN: process.env.SHOPIFY_STOREFRONT_DOMAIN || '',
  };
}

export default { getEnv, getShopifyConfig };

