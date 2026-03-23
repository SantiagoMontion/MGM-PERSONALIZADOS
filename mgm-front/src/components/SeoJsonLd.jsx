import React from 'react';
import { Helmet } from 'react-helmet-async';

const BASE = {
  siteName: 'NOTMID',
  canonical: 'https://personalizados.notmid.ar/',
  title: 'Mousepad Personalizado a Medida | Calidad Gamer y Profesional | NOTMID',
  description:
    'Dise\u00F1\u00E1 tu mousepad personalizado a medida con calidad profesional. Ideal para gaming, trabajo o setup creativo. Env\u00EDos a todo el pa\u00EDs \u2013 NOTMID.',
  keywords:
    'mousepad personalizado, mousepad gamer personalizado, mousepad a medida, deskmat personalizado, mousepad grande personalizado',
  ogImage: 'https://personalizados.notmid.ar/og/notmid-og-1200x630.png',
  ogImageAlt: 'NOTMID - Mousepads personalizados a medida',
  locale: 'es_AR'
};

export default function SeoJsonLd({
  title = BASE.title,
  description = BASE.description,
  keywords = BASE.keywords,
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
        <meta name="keywords" content={keywords} />
        <link rel="canonical" href={canonical} />
        {noIndex && <meta name="robots" content="noindex,nofollow" />}

        {/* Open Graph / NOTMID */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={BASE.siteName} />
        <meta property="og:locale" content={BASE.locale} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={BASE.ogImageAlt} />

        {/* Twitter / NOTMID */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={ogImage} />
        <meta name="twitter:image:alt" content={BASE.ogImageAlt} />

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

