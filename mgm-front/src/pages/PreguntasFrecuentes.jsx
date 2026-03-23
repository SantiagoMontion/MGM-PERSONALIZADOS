import SeoJsonLd from '../components/SeoJsonLd';

export default function PreguntasFrecuentes() {
  const title = 'Preguntas Frecuentes | NOTMID';
  const description = 'Respuestas a dudas comunes sobre nuestros mousepads personalizados.';
  const url = 'https://personalizados.notmid.ar/preguntas-frecuentes';

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
      <h1>Preguntas frecuentes</h1>
      <p>Pr\u00F3ximamente preguntas y respuestas.</p>
    </>
  );
}
