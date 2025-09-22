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

function normalizeCandidate(raw) {
  const withProtocol = preferHttps(raw);
  if (!withProtocol) return null;
  try {
    const url = new URL(withProtocol);
    if (shouldForceWww(url.hostname)) {
      url.hostname = `www.${url.hostname}`;
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function scoreHostname(hostname = '') {
  const host = hostname.toLowerCase();
  let score = 0;
  if (!host) return score;
  if (host.includes('mgmgamers')) score += 200;
  if (!host.endsWith('.myshopify.com')) score += 50;
  if (host.startsWith('www.')) score += 5;
  return score;
}

export function getPublicStorefrontBase() {
  const candidates = [
    process.env.SHOPIFY_HOME_URL,
    process.env.SHOPIFY_PUBLIC_BASE,
    process.env.SHOPIFY_STOREFRONT_DOMAIN,
    process.env.SHOPIFY_STORE_DOMAIN,
    'https://www.mgmgamers.store',
  ];

  const normalized = candidates
    .map((candidate, index) => {
      const url = normalizeCandidate(candidate);
      if (!url) return null;
      return { url, score: scoreHostname(url.hostname), index };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

  if (!normalized.length) return '';
  return normalized[0].url.origin;
}

export function buildProductUrl(handle) {
  if (!handle) return undefined;
  const base = getPublicStorefrontBase();
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/products/${handle}`;
}
