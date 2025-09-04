import { Helmet } from 'react-helmet';

export default function ComoFunciona() {
  const title = 'Cómo funciona — MGMGAMERS';
  const description = 'Explicación del proceso para crear tu mousepad personalizado.';
  const url = 'https://www.mgmgamers.store/como-funciona';
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
      </Helmet>
      <h1>Cómo funciona</h1>
      <p>Próximamente la explicación del proceso.</p>
    </>
  );
}
