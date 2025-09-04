import SeoJsonLd from '../components/SeoJsonLd';

export default function PreguntasFrecuentes() {
  const title = 'Preguntas frecuentes — MGMGAMERS';
  const description = 'Respuestas a dudas comunes sobre nuestros mousepads personalizados.';
  const url = 'https://www.mgmgamers.store/preguntas-frecuentes';
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
      <h1>Preguntas frecuentes</h1>
      <p>Próximamente preguntas y respuestas.</p>
    </>
  );
}
