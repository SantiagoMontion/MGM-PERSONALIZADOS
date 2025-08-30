import LegalLayout from './LegalLayout.jsx';

export default function Privacidad() {
  return (
    <LegalLayout
      title="Política de privacidad"
      description="Cómo manejamos tus datos"
      canonical="/legal/privacidad"
    >
      <section>
        <h2>Datos que recolectamos</h2>
        <p>Recopilamos tu email, diseños e información de medidas para poder fabricar y vender tu producto.</p>
        <h2>Uso de datos</h2>
        <p>Utilizamos estos datos sólo para producir tus pedidos y mejorar el servicio. Podés solicitar el borrado escribiéndonos.</p>
        <h2>Retención</h2>
        <p>Los archivos de diseños no pagados se conservan hasta 30 días.</p>
      </section>
    </LegalLayout>
  );
}
