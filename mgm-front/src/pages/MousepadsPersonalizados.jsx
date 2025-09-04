import { Helmet } from 'react-helmet';

export default function MousepadsPersonalizados() {
  const title = 'Mousepads Profesionales Personalizados — MGMGAMERS';
  const description = 'Mousepad Profesionales Personalizados, Gamers, diseño y medida que quieras. Perfectos para gaming control y speed.';
  const url = 'https://www.mgmgamers.store/mousepads-personalizados';
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="MGMGAMERS" />
        <meta property="og:url" content={url} />
        <meta property="og:image" content="/og/og-default.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content="/og/og-default.png" />
      </Helmet>
      <h1>Mousepads Profesionales Personalizados</h1>
      <p>Próximamente contenido del catálogo.</p>
    </>
  );
}
