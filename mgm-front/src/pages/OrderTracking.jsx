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

  const currentTag = mockOrder.tags.find((tag) => stageByTag[tag]);
  const currentStage = currentTag
    ? stageByTag[currentTag]
    : {
        title: 'Tu pedido está siendo preparado',
        description: 'Estamos actualizando el estado de tu pedido. En breve vas a ver más detalles.',
        mediaLabel: 'Estado en actualización',
      };

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-sm sm:p-6">
        <p className="text-sm text-neutral-300">Seguimiento de pedido</p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-100 sm:text-3xl">Pedido #{mockOrder.orderNumber}</h1>
        <p className="mt-2 text-sm text-neutral-300">Cliente: {mockOrder.customerName}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Estado de pago</p>
          <p className="mt-2 text-lg font-medium text-neutral-100">
            {mockOrder.financialStatus === 'paid' ? 'Pagado' : 'Pendiente de pago'}
          </p>
        </article>

        <article className="rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Total</p>
          <p className="mt-2 text-lg font-medium text-neutral-100">{mockOrder.totalPrice}</p>
        </article>
      </div>

      {mockOrder.financialStatus === 'pending' && (
        <article className="rounded-lg border border-amber-500/50 bg-neutral-900 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-100">Pago pendiente: transferencia bancaria</h2>
          <div className="mt-3 space-y-1 text-sm text-neutral-300">
            <p>CBU: 0000003100098765432101</p>
            <p>Alias: MGM.GAMERS.SJ</p>
            <p>Banco: Banco Nación</p>
          </div>
        </article>
      )}

      <article className="rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold text-neutral-100">{currentStage.title}</h2>
        <p className="mt-2 text-sm text-neutral-300">{currentStage.description}</p>

        <div className="mt-4 rounded-md border border-dashed border-neutral-600 bg-neutral-800/60 p-6 text-center text-sm text-neutral-400">
          {currentStage.mediaLabel} (contenedor para video/imagen)
        </div>
      </article>

      {mockOrder.trackingUrl && (
        <div>
          <a
            href={mockOrder.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-lg border border-neutral-600 bg-neutral-100 px-5 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white"
          >
            Ir al seguimiento externo
          </a>
        </div>
      )}
    </section>
  );
}
