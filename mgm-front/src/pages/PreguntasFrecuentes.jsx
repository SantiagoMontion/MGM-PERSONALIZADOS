import { Helmet } from 'react-helmet';

export default function PreguntasFrecuentes() {
  const title = 'Preguntas frecuentes — MGMGAMERS';
  const description = 'Respuestas a dudas comunes sobre nuestros mousepads personalizados.';
  const url = 'https://www.mgmgamers.store/preguntas-frecuentes';
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
      </Helmet>
      <h1>Preguntas frecuentes</h1>
      <p>Próximamente preguntas y respuestas.</p>
    </>
  );
}
