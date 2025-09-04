import React from 'react';
import { Helmet } from 'react-helmet-async';

const BASE = {
  siteName: 'MGMGAMERS',
  canonical: 'https://www.mgmgamers.store',
  title: 'Tu Mousepad Personalizado — MGMGAMERS',
  description:
    'Mousepad Profesionales Personalizados, Gamers, diseño y medida que quieras. Perfectos para gaming control y speed.',
  ogImage: '/og/og-default.png',
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
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: ld }}
        />
      )}
    </>
  );
}
