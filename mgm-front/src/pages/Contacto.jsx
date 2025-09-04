import SeoJsonLd from '../components/SeoJsonLd';

export default function Contacto() {
  const title = 'Contacto — MGMGAMERS';
  const description = 'Ponte en contacto con MGMGAMERS para tus mousepads personalizados.';
  const url = 'https://www.mgmgamers.store/contacto';
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
      <h1>Contacto</h1>
      <p>Próximamente información de contacto.</p>
    </>
  );
}
