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
  return {
    STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN || '',
    ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN || '',
    API_VERSION: process.env.SHOPIFY_API_VERSION || '2024-07',
    STOREFRONT_TOKEN: process.env.SHOPIFY_STOREFRONT_TOKEN || '',
    STOREFRONT_DOMAIN: process.env.SHOPIFY_STOREFRONT_DOMAIN || '',
  };
}

export default { getEnv, getShopifyConfig };

