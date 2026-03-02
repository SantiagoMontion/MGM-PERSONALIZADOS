import styles from './OrderTracking.module.css';

export default function OrderTracking() {
  const mockOrder = {
    orderNumber: 'MGM-2026-00125',
    customerName: 'Juan Pérez',
    financialStatus: 'pending',
    tags: ['en_diseno'],
    totalPrice: '$ 59.900',
    trackingUrl: 'https://example.com/seguimiento/MGM-2026-00125',
  };

  const stageByTag = {
    en_diseno: {
      title: 'Tu pedido está en diseño',
      description:
        'Estamos preparando y validando tu diseño final para garantizar la mejor calidad de impresión.',
      mediaLabel: 'Vista previa del diseño',
    },
    imprimiendo: {
      title: 'Tu pedido está en impresión',
      description:
        'Tu mousepad ya entró a producción. En esta etapa estamos imprimiendo el diseño sobre el material seleccionado.',
      mediaLabel: 'Proceso de impresión',
    },
    prensando: {
      title: 'Tu pedido está en prensado',
      description:
        'Estamos terminando los detalles finales de fabricación para asegurar la durabilidad y terminación del producto.',
      mediaLabel: 'Proceso de prensado',
    },
  };

  const activeTag = mockOrder.tags.find((tag) => stageByTag[tag]);
  const activeStage = activeTag
    ? stageByTag[activeTag]
    : {
      title: 'Tu pedido está siendo preparado',
      description: 'Estamos actualizando el estado de tu pedido. En breve vas a ver más detalles.',
      mediaLabel: 'Estado en actualización',
    };

  return (
    <section className={styles.container}>
      <header className={styles.card}>
        <p className={styles.eyebrow}>Seguimiento de pedido</p>
        <h1 className={styles.title}>Pedido #{mockOrder.orderNumber}</h1>
        <p className={styles.subtitle}>Cliente: {mockOrder.customerName}</p>
      </header>

      <div className={styles.summaryGrid}>
        <article className={styles.card}>
          <p className={styles.label}>Estado de pago</p>
          <p className={styles.value}>{mockOrder.financialStatus === 'paid' ? 'Pagado' : 'Pendiente de pago'}</p>
        </article>

        <article className={styles.card}>
          <p className={styles.label}>Total</p>
          <p className={styles.value}>{mockOrder.totalPrice}</p>
        </article>
      </div>

      {mockOrder.financialStatus === 'pending' && (
        <article className={`${styles.card} ${styles.pendingCard}`}>
          <h2 className={styles.pendingTitle}>Pago pendiente: transferencia bancaria</h2>
          <div className={styles.pendingInfo}>
            <p>CBU: 0000003100098765432101</p>
            <p>Alias: MGM.GAMERS.SJ</p>
            <p>Banco: Banco Nación</p>
          </div>
        </article>
      )}

      <article className={styles.card}>
        <h2 className={styles.sectionTitle}>{activeStage.title}</h2>
        <p className={styles.sectionDescription}>{activeStage.description}</p>
        <div className={styles.mediaPlaceholder}>{activeStage.mediaLabel} (contenedor para video/imagen)</div>
      </article>

      {mockOrder.trackingUrl && (
        <div className={styles.actions}>
          <a
            href={mockOrder.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.trackingButton}
          >
            Ir al seguimiento externo
          </a>
        </div>
      )}
    </section>
  );
}
