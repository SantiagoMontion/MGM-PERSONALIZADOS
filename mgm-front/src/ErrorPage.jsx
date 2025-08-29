import { useRouteError } from 'react-router-dom';

export default function ErrorPage() {
  const error = useRouteError();
  console.error(error);
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Oops!</h1>
      <p>Lo sentimos, ha ocurrido un error inesperado.</p>
      {error && (
        <pre style={{ whiteSpace: 'pre-wrap', color: '#b91c1c' }}>
          {error.statusText || error.message}
        </pre>
      )}
    </div>
  );
}
