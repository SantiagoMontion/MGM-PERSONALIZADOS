import SeoJsonLd from '../components/SeoJsonLd';

export default function ComoFunciona() {
  const title = 'Cómo funciona — MGMGAMERS';
  const description = 'Explicación del proceso para crear tu mousepad personalizado.';
  const url = 'https://www.mgmgamers.store/como-funciona';
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
      <h1>Cómo funciona</h1>
      <p>Próximamente la explicación del proceso.</p>
    </>
  );
}
