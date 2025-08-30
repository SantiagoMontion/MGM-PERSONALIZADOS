import LegalLayout from './LegalLayout.jsx';

export default function Terminos() {
  return (
    <LegalLayout
      title="Términos de uso"
      description="Condiciones para utilizar el servicio"
      canonical="/legal/terminos"
    >
      <section>
        <h2>Uso del servicio</h2>
        <p>
          El uso del editor y de los servicios de fabricación implica tu aceptación de estos
          términos. Conservás la propiedad de tus imágenes y nos otorgás una licencia limitada
          para producir el producto y generar mockups.
        </p>
        <h2>Limitación de responsabilidad</h2>
        <p>
          No somos responsables por daños indirectos o pérdidas de datos. El servicio se ofrece
          "tal cual" sin garantías adicionales.
        </p>
        <h2>Ley aplicable</h2>
        <p>Estos términos se rigen por las leyes de Argentina. Para cualquier consulta:
          contactanos.</p>
      </section>
    </LegalLayout>
  );
}
