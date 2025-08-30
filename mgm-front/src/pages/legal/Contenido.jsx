import LegalLayout from './LegalLayout.jsx';

export default function Contenido() {
  return (
    <LegalLayout
      title="Política de contenidos"
      description="Qué contenidos se permiten"
      canonical="/legal/contenido"
    >
      <section>
        <p>No se permiten contenidos ilegales, violentos o que infrinjan derechos de terceros. Nos reservamos el derecho de rechazar cualquier diseño.</p>
        <p>Si detectamos contenido sospechoso podremos revisar manualmente y cancelar el pedido.</p>
      </section>
    </LegalLayout>
  );
}
