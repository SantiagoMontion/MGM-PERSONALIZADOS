import SeoJsonLd from '../components/SeoJsonLd';

export default function MousepadsPersonalizados() {
  const title = 'Mousepads Profesionales Personalizados — NOTMID';
  const description = 'Mousepad Profesionales Personalizados, Gamers, diseño y medida que quieras. Perfectos para gaming control y speed.';
  const url = 'https://personalizados.notmid.ar/mousepads-personalizados';
  return (
    <>
      <SeoJsonLd
        title={title}
        description={description}
        canonical={url}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'NOTMID',
          url: 'https://personalizados.notmid.ar',
          sameAs: ['https://www.instagram.com/mgmgamers.store']
        }}
      />
      <h1>Mousepads Profesionales Personalizados</h1>
      <p>Próximamente contenido del catálogo.</p>
    </>
  );
}
