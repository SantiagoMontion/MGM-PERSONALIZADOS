export const SITE = {
  name: 'NOTMID',
  baseUrl: 'https://notmid.ar',
  locale: 'es-AR',
  ogLocale: 'es_AR',
  defaultOgPath: '/og/og-default.png',
  instagram: 'https://www.instagram.com/notmid.ar',
  keywords: [
    'mousepad gamer personalizado',
    'glasspad gamer personalizado',
    'mousepad de tela personalizado Argentina',
    'alfombrilla gamer personalizada',
    'pad gamer personalizado Argentina',
  ],
  organizationLogoPath: '/icons/icon-512.png',
};

export function absoluteUrl(path = '/') {
  const trimmed = typeof path === 'string' ? path.trim() : '';
  if (!trimmed) return SITE.baseUrl;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${SITE.baseUrl}${normalized}`;
}

export function ensureAbsoluteUrl(candidate) {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  if (!value) return absoluteUrl(SITE.defaultOgPath);
  if (/^https?:\/\//i.test(value)) return value;
  return absoluteUrl(value);
}

export function buildDefaultImageUrl() {
  return ensureAbsoluteUrl(SITE.defaultOgPath);
}
