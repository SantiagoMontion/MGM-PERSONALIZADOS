import SeoJsonLd from '../components/SeoJsonLd';

export default function Tutorial() {
  const title = 'Tutorial — MGMGAMERS';
  const description = 'Próximamente: guía para utilizar el editor y crear tu mousepad.';
  const url = 'https://www.mgmgamers.store/tutorial';

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
      <h1>Tutorial</h1>
      <p>Próximamente.</p>
    </>
  );
}
