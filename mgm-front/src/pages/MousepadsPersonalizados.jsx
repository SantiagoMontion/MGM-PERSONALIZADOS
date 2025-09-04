import SeoJsonLd from '../components/SeoJsonLd';

export default function MousepadsPersonalizados() {
  const title = 'Mousepads Profesionales Personalizados — MGMGAMERS';
  const description = 'Mousepad Profesionales Personalizados, Gamers, diseño y medida que quieras. Perfectos para gaming control y speed.';
  const url = 'https://www.mgmgamers.store/mousepads-personalizados';
  return (
    <>
      <SeoJsonLd
        title={title}
        description={description}
        canonical={url}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'MGMGAMERS',
          url: 'https://www.mgmgamers.store',
          sameAs: ['https://www.instagram.com/mgmgamers.store']
        }}
      />
      <h1>Mousepads Profesionales Personalizados</h1>
      <p>Próximamente contenido del catálogo.</p>
    </>
  );
}
