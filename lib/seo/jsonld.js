import { SITE, ensureAbsoluteUrl } from './constants.js';
import { normalizePrice } from './utils.js';

export function buildOrganizationJsonLd() {
  const logoUrl = ensureAbsoluteUrl(SITE.organizationLogoPath);
  const sameAs = [SITE.instagram].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.baseUrl,
    logo: logoUrl,
    sameAs,
  };
}

export function buildProductJsonLd({
  name,
  description,
  image,
  price,
  currency = 'ARS',
  material,
  availability = 'InStock',
  canonical,
  sku,
  width,
  height,
}) {
  const normalizedPrice = normalizePrice(price);
  const offers = normalizedPrice
    ? {
        '@type': 'Offer',
        price: normalizedPrice,
        priceCurrency: currency,
        availability: availability.startsWith('http')
          ? availability
          : `https://schema.org/${availability}`,
        url: canonical,
        itemCondition: 'https://schema.org/NewCondition',
        seller: {
          '@type': 'Organization',
          name: SITE.name,
          url: SITE.baseUrl,
        },
      }
    : undefined;

  const additionalProperties = [];
  if (width || height) {
    additionalProperties.push({
      '@type': 'PropertyValue',
      name: 'Dimensiones',
      value: [width, height].filter(Boolean).join(' x '),
      unitCode: 'CMT',
    });
  }
  if (material) {
    additionalProperties.push({
      '@type': 'PropertyValue',
      name: 'Material',
      value: material,
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    image: [ensureAbsoluteUrl(image)],
    sku,
    brand: {
      '@type': 'Brand',
      name: SITE.name,
    },
    material,
    offers,
    additionalProperty: additionalProperties.length ? additionalProperties : undefined,
  };
}
