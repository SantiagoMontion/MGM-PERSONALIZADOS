import SeoJsonLd from '../components/SeoJsonLd';

export default function MousepadsPersonalizados() {
  const title = 'Mousepads Profesionales Personalizados | NOTMID';
  const description = 'Mousepads personalizados de calidad profesional para gaming, trabajo y setups creativos.';
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
          url: 'https://personalizados.notmid.ar/',
        }}
      />
      <h1>Mousepads Profesionales Personalizados</h1>
      <p>Pr\u00F3ximamente contenido del cat\u00E1logo.</p>
    </>
  );
}
