import React from 'react';
import { Helmet } from 'react-helmet-async';

const BASE = {
  siteName: 'NOTMID',
  canonical: 'https://personalizados.notmid.ar/',
  title: 'Mousepad Personalizado a Medida | Calidad Gamer y Profesional | NOTMID',
  description:
    'Diseñá tu mousepad personalizado a medida con calidad profesional. Ideal para gaming, trabajo o setup creativo. Envíos a todo el país – NOTMID.',
  keywords:
    'mousepad personalizado, mousepad gamer personalizado, mousepad a medida, deskmat personalizado, mousepad grande personalizado',
  ogImage: 'https://personalizados.notmid.ar/og/notmid-og-1200x630.svg',
  locale: 'es_AR'
};

export default function SeoJsonLd({
  title = BASE.title,
  description = BASE.description,
  canonical = BASE.canonical,
  ogImage = BASE.ogImage,
  noIndex = false,
  jsonLd = null
}) {
  const ld = jsonLd ? JSON.stringify(jsonLd) : null;

  return (
    <>
      <Helmet prioritizeSeoTags>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="keywords" content={BASE.keywords} />
        <link rel="canonical" href={canonical} />
        {noIndex && <meta name="robots" content="noindex,nofollow" />}

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={BASE.siteName} />
        <meta property="og:locale" content={BASE.locale} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={ogImage} />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={ogImage} />

        {/* Idioma */}
        <html lang="es-AR" />
      </Helmet>

      {ld && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: ld }}
        />
      )}
    </>
  );
}
