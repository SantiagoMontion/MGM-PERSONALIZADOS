import { Helmet } from 'react-helmet';

export default function Contacto() {
  const title = 'Contacto — MGMGAMERS';
  const description = 'Ponte en contacto con MGMGAMERS para tus mousepads personalizados.';
  const url = 'https://www.mgmgamers.store/contacto';
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
      </Helmet>
      <h1>Contacto</h1>
      <p>Próximamente información de contacto.</p>
    </>
  );
}
