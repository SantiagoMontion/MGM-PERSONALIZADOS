import SeoJsonLd from '../components/SeoJsonLd';

export default function Tutorial() {
  const title = 'Tutorial | NOTMID';
  const description = 'Pr\u00F3ximamente: gu\u00EDa para utilizar el editor y crear tu mousepad.';
  const url = 'https://personalizados.notmid.ar/tutorial';

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
          url: 'https://personalizados.notmid.ar/',
        }}
      />
      <h1>Tutorial</h1>
      <p>Pr\u00F3ximamente.</p>
    </>
  );
}
