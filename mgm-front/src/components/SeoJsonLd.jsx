import { Helmet } from 'react-helmet';

const BASE_DATA = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "MGMGAMERS",
    "url": "https://www.mgmgamers.store",
    "logo": "/icons/icon-512.png",
    "sameAs": ["https://www.instagram.com/mgmgamers.store"]
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "url": "https://www.mgmgamers.store",
    "name": "MGMGAMERS"
  }
];

export default function SeoJsonLd({ product, includeBase = true }) {
  const data = [];
  if (includeBase) data.push(...BASE_DATA);
  if (product) {
    data.push({
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Mousepad Personalizado",
      "brand": "MGMGAMERS",
      "description": "Mousepad Profesionales Personalizados, Gamers, diseño y medida que quieras. Perfectos para gaming control y speed.",
      "image": product.image,
      "offers": {
        "@type": "Offer",
        "priceCurrency": "ARS",
        "price": String(product.price ?? 0),
        "availability": "https://schema.org/InStock"
      }
    });
  }
  if (!data.length) return null;
  return (
    <Helmet>
      <script type="application/ld+json">
        {JSON.stringify(data.length === 1 ? data[0] : data)}
      </script>
    </Helmet>
  );
}
