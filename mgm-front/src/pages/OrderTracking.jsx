import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const mockOrdersDB = {
  '1001': {
    orderNumber: '1001',
    customerName: 'Juan Pérez',
    financialStatus: 'pending',
    tags: ['en_diseno'],
    totalPrice: '$ 59.900',
    trackingUrl: '',
  },
  '1002': {
    orderNumber: '1002',
    customerName: 'Micaela Gómez',
    financialStatus: 'paid',
    tags: ['imprimiendo'],
    totalPrice: '$ 78.500',
    trackingUrl: '',
  },
  '1003': {
    orderNumber: '1003',
    customerName: 'Lucas Fernández',
    financialStatus: 'paid',
    tags: ['prensando'],
    totalPrice: '$ 92.300',
    trackingUrl: 'https://seguimiento.andreani.com/envio/1003',
  },
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

const fallbackStage = {
  title: 'Tu pedido está siendo preparado',
  description: 'Estamos actualizando el estado de tu pedido. En breve vas a ver más detalles.',
  mediaLabel: 'Estado en actualización',
};

export default function OrderTracking() {
  const { orderId } = useParams();
  const [isLoading, setIsLoading] = useState(true);
  const [order, setOrder] = useState(null);

  useEffect(() => {
    setIsLoading(true);
    const timeoutId = setTimeout(() => {
      const foundOrder = mockOrdersDB[orderId] ?? null;
      setOrder(foundOrder);
      setIsLoading(false);
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [orderId]);

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <article className="rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-[0_20px_35px_rgba(0,0,0,0.35)]">
          <p className="text-sm text-neutral-300">Cargando pedido...</p>
        </article>
      </section>
    );
  }

  if (!order) {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <article className="rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-[0_20px_35px_rgba(0,0,0,0.35)]">
          <p className="text-xs uppercase tracking-[0.08em] text-neutral-400">Seguimiento de pedido</p>
          <h1 className="mt-2 text-2xl font-bold text-white">Pedido no encontrado</h1>
          <p className="mt-2 text-sm text-neutral-300">
            No encontramos resultados para el ID <span className="font-semibold text-neutral-100">{orderId}</span>.
          </p>
        </article>
      </section>
    );
  }

  const activeTag = order.tags.find((tag) => stageByTag[tag]);
  const activeStage = activeTag ? stageByTag[activeTag] : fallbackStage;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-[0_20px_35px_rgba(0,0,0,0.35)]">
        <p className="text-xs uppercase tracking-[0.08em] text-neutral-400">Seguimiento de pedido</p>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Pedido #{order.orderNumber}</h1>
        <p className="mt-2 text-sm text-neutral-300">Cliente: {order.customerName}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-[0_20px_35px_rgba(0,0,0,0.35)]">
          <p className="text-xs uppercase tracking-[0.08em] text-neutral-400">Estado de pago</p>
          <p className="mt-2 text-lg font-semibold text-neutral-100">
            {order.financialStatus === 'paid' ? 'Pagado' : 'Pendiente de pago'}
          </p>
        </article>

        <article className="rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-[0_20px_35px_rgba(0,0,0,0.35)]">
          <p className="text-xs uppercase tracking-[0.08em] text-neutral-400">Total</p>
          <p className="mt-2 text-lg font-semibold text-neutral-100">{order.totalPrice}</p>
        </article>
      </div>

      {order.financialStatus === 'pending' && (
        <article className="rounded-2xl border border-amber-400/40 bg-[#181818] p-6 shadow-[0_20px_35px_rgba(0,0,0,0.35)]">
          <h2 className="text-lg font-semibold text-amber-100">Pago pendiente: transferencia bancaria</h2>
          <div className="mt-3 space-y-1 text-sm text-neutral-200">
            <p>CBU: 0000003100098765432101</p>
            <p>Alias: MGM.GAMERS.SJ</p>
            <p>Banco: Banco Nación</p>
          </div>
        </article>
      )}

      <article className="rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-[0_20px_35px_rgba(0,0,0,0.35)]">
        <h2 className="text-xl font-semibold text-neutral-100">{activeStage.title}</h2>
        <p className="mt-2 text-sm text-neutral-300">{activeStage.description}</p>
        <div className="mt-4 flex min-h-40 items-center justify-center rounded-xl border border-dashed border-neutral-500/70 bg-[#1f2937]/45 p-5 text-center text-sm text-neutral-400">
          {activeStage.mediaLabel} (contenedor para video/imagen)
        </div>
      </article>

      {order.trackingUrl && (
        <div>
          <a
            href={order.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-neutral-100 px-5 py-2.5 text-sm font-semibold text-neutral-900"
          >
            Ir al seguimiento externo
          </a>
        </div>
      )}
    </section>
  );
}
