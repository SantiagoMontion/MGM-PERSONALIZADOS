const preferHttps = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
};

const shouldForceWww = (hostname) => {
  if (!hostname || typeof hostname !== 'string') return false;
  if (hostname.startsWith('www.')) return false;
  if (hostname.endsWith('.myshopify.com')) return false;
  const parts = hostname.split('.').filter(Boolean);
  return parts.length === 2;
};

export function getPublicStorefrontBase() {
  const candidates = [
    process.env.SHOPIFY_PUBLIC_BASE,
    process.env.SHOPIFY_STOREFRONT_DOMAIN,
    process.env.SHOPIFY_STORE_DOMAIN,
  ];

  for (const candidate of candidates) {
    const withProtocol = preferHttps(candidate);
    if (!withProtocol) continue;
    try {
      const url = new URL(withProtocol);
      if (shouldForceWww(url.hostname)) {
        url.hostname = `www.${url.hostname}`;
      }
      url.pathname = '';
      url.search = '';
      url.hash = '';
      return url.origin;
    } catch {
      // ignore and keep trying
    }
  }
  return '';
}

export function buildProductUrl(handle) {
  if (!handle) return undefined;
  const base = getPublicStorefrontBase();
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/products/${handle}`;
}
