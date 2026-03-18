import SeoJsonLd from '../components/SeoJsonLd';

export default function PreguntasFrecuentes() {
  const title = 'Preguntas frecuentes — NOTMID';
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
          url: 'https://personalizados.notmid.ar',
          sameAs: ['https://www.instagram.com/mgmgamers.store']
        }}
      />
      <h1>Preguntas frecuentes</h1>
      <p>Próximamente preguntas y respuestas.</p>
    </>
  );
}
