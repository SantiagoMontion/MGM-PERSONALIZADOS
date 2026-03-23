import SeoJsonLd from '../components/SeoJsonLd';

export default function ComoFunciona() {
  const title = 'C\u00F3mo funciona | NOTMID';
  const description = 'Explicaci\u00F3n del proceso para crear tu mousepad personalizado.';
  const url = 'https://personalizados.notmid.ar/como-funciona';

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
      <h1>C\u00F3mo funciona</h1>
      <p>Pr\u00F3ximamente la explicaci\u00F3n del proceso.</p>
    </>
  );
}
