import { buildDefaultImageUrl } from './constants.js';
import {
  buildKeywords,
  canonicalUrl,
  describeMaterial,
  ensureImageUrl,
  formatCurrency,
  formatMeasurement,
  formatNumber,
  sanitizeText,
} from './utils.js';
import { renderPageLayout, renderSeoDocument } from './templates.js';
import { buildOrganizationJsonLd, buildProductJsonLd } from './jsonld.js';
import { fetchJobForSeo } from './productData.js';

export function renderHomePage() {
  const canonical = canonicalUrl('/');
  const keywords = buildKeywords([
    'mousepads gamers Argentina',
    'personalización de Glasspad',
    'diseñar mousepad online',
  ]);
  const hero = {
    eyebrow: 'MGMGAMERS · Argentina',
    heading: 'Mousepad gamer personalizado hecho a tu medida',
    subheading:
      'Diseñá mousepads de tela o Glasspads gamers con impresión HD, bordes reforzados y envío rápido a todo Argentina.',
    stats: [
      { label: 'Materiales', value: 'Tela premium y Glasspad de vidrio' },
      { label: 'Producción', value: 'Hecho en Argentina' },
      { label: 'Entrega', value: 'Envío a todo el país' },
    ],
  };
  const sections = [
    {
      heading: '¿Por qué elegir un mousepad gamer personalizado en Argentina?',
      paragraphs: [
        'Un mousepad gamer personalizado eleva tu setup competitivo con una superficie optimizada para eSports y un diseño único. En MGMGAMERS imprimimos en alta definición sobre materiales profesionales para que cada movimiento sea preciso.',
        'Trabajamos con tintas resistentes y un proceso de curado que conserva la saturación del color incluso después de sesiones intensas de juego o prácticas de aim.',
      ],
      list: {
        items: [
          'Opciones speed y control para distintos estilos de juego competitivo.',
          'Impresión full color preparada para resoluciones de hasta 300 DPI.',
          'Costuras reforzadas y base antideslizante para torneos en Argentina.',
        ],
      },
    },
    {
      heading: 'Glasspad gamer personalizado o tela profesional',
      paragraphs: [
        'Elegí entre Glasspad gamer personalizado con fricción mínima o mousepad de tela personalizado Argentina para lograr control absoluto. Nuestro laboratorio calibra cada material para que la sensación sea consistente en torneos LAN o streams desde casa.',
        'Todas las piezas se producen localmente, por lo que podés aprovechar soporte en español y reposiciones rápidas sin depender de envíos internacionales.',
      ],
    },
    {
      heading: 'Proceso 100% online con entrega nacional',
      paragraphs: [
        'Subí tu diseño, seleccioná medidas estándar o personalizadas y recibí una vista previa antes de imprimir. Nuestro equipo revisa cada archivo para garantizar nitidez y cumplimiento de márgenes de seguridad.',
        'Coordinamos envíos a todo el país y brindamos seguimiento en español para que tu mousepad gamer personalizado llegue listo para competir.',
      ],
    },
  ];
  const bodyHtml = renderPageLayout({ hero, sections });

  const html = renderSeoDocument({
    title: 'Mousepad Gamer Personalizado - Diseñá el Tuyo | MGMGAMERS',
    description:
      'Creá mousepads gamers personalizados o Glasspads en MGMGAMERS. Alta calidad, ideales para esports, con envío rápido en Argentina.',
    canonical,
    keywords,
    ogImage: buildDefaultImageUrl(),
    ogImageAlt: 'Mousepad gamer personalizado argentino',
    jsonLd: [buildOrganizationJsonLd()],
    bodyHtml,
  });
  return html;
}

export function renderEditorPage() {
  const canonical = canonicalUrl('/mockup');
  const keywords = buildKeywords([
    'editor de mousepad gamer',
    'personalizar glasspad argentina',
    'diseñar mousepad de tela',
  ]);
  const hero = {
    eyebrow: 'Editor online',
    heading: 'Diseñá tu mousepad gamer personalizado en minutos',
    subheading:
      'Subí tu arte, elegí medidas en centímetros y ajustá la vista previa en tiempo real. Compatible con mousepads de tela y Glasspads premium hechos en Argentina.',
    stats: [
      { label: 'Formatos', value: 'Medidas estándar y personalizadas' },
      { label: 'Salida', value: 'Archivos listos para impresión 300 DPI' },
      { label: 'Materiales', value: 'Tela PRO, Classic y Glasspad' },
    ],
  };

  const sections = [
    {
      heading: 'Herramientas pensadas para esports',
      paragraphs: [
        'El editor valida resolución mínima para asegurar un mousepad gamer personalizado de alta fidelidad. Podés posicionar tu logo, agregar fondos y revisar el sangrado antes de enviar a producción.',
      ],
      list: {
        items: [
          'Control de DPI y alertas cuando la imagen no alcanza calidad competitiva.',
          'Plantillas para Glasspad gamer personalizado con medidas oficiales.',
          'Opciones de material para speed o control según tu estilo de juego.',
        ],
      },
    },
    {
      heading: 'Flujo guiado para publicar o comprar',
      paragraphs: [
        'Una vez que confirmás el diseño, generamos mockups, archivos print-ready y enlaces de checkout para Argentina. Podés agregar el mousepad al carrito, comprar al instante o solicitar una publicación privada.',
        'El backend asegura que los datos SEO y las vistas previas estén optimizadas para compartir tu diseño con tu comunidad gamer.',
      ],
    },
    {
      heading: 'Recomendaciones de diseño profesional',
      paragraphs: [
        'Trabajá en modo RGB, subí imágenes de al menos 300 DPI y mantené elementos críticos fuera del área de seguridad. Así garantizamos un mousepad de tela personalizado Argentina sin cortes ni pérdida de detalles.',
      ],
    },
  ];

  const bodyHtml = renderPageLayout({ hero, sections });

  return renderSeoDocument({
    title: 'Diseñá tu Mousepad Gamer Personalizado | MGMGAMERS',
    description:
      'Personalizá un mousepad de tela o Glasspad para gaming. Subí tu diseño y elegí el tamaño para un rendimiento profesional en Argentina.',
    canonical,
    keywords,
    ogImage: buildDefaultImageUrl(),
    ogImageAlt: 'Editor de mousepads personalizados MGMGAMERS',
    jsonLd: [buildOrganizationJsonLd()],
    bodyHtml,
  });
}

export function renderCheckoutPage() {
  const canonical = canonicalUrl('/confirm');
  const keywords = buildKeywords([
    'checkout mousepad personalizado',
    'comprar glasspad gamer argentina',
    'pago seguro mousepad gamer',
  ]);
  const hero = {
    eyebrow: 'Checkout protegido',
    heading: 'Finalizá tu compra de mousepads personalizados',
    subheading:
      'Revisá el resumen de tu diseño, confirmá medidas y coordiná envío dentro de Argentina con soporte en español.',
    stats: [
      { label: 'Soporte', value: 'Acompañamiento en español' },
      { label: 'Control', value: 'Verificación manual del archivo' },
      { label: 'Envío', value: 'Seguimiento puerta a puerta' },
    ],
  };

  const sections = [
    {
      heading: 'Resumen del pedido optimizado para gamers',
      paragraphs: [
        'Antes de abonar confirmás material, tamaño y vista previa del mousepad gamer personalizado. Nuestro equipo valida nuevamente la calidad del archivo antes de imprimir.',
      ],
    },
    {
      heading: 'Envíos dentro de Argentina',
      paragraphs: [
        'Coordinamos envíos a CABA, GBA y provincias con transportes de confianza. Te compartimos el seguimiento para que sepas cuándo llega tu mousepad de tela personalizado o Glasspad.',
      ],
    },
    {
      heading: 'Pagos seguros y asistencia',
      paragraphs: [
        'Trabajamos con pasarelas de pago seguras y soporte humano para resolver dudas en el proceso. Si necesitás factura o cambios de último momento, nos contactás desde el mismo panel.',
      ],
    },
  ];

  const bodyHtml = renderPageLayout({ hero, sections });

  return renderSeoDocument({
    title: 'Finalizá tu Compra de Mousepads Personalizados | MGMGAMERS',
    description:
      'Confirmá tu pedido de mousepads gamers personalizados o Glasspads. Pagos seguros y envíos a todo Argentina con soporte local.',
    canonical,
    keywords,
    ogImage: buildDefaultImageUrl(),
    ogImageAlt: 'Checkout de mousepads personalizados MGMGAMERS',
    jsonLd: [buildOrganizationJsonLd()],
    bodyHtml,
  });
}

export async function renderProductPage(jobId) {
  const job = await fetchJobForSeo(jobId);
  if (!job) {
    return renderMissingProduct(jobId);
  }

  const canonical = canonicalUrl(`/result/${job.job_id}`);
  const designName = sanitizeText(job.design_name) || 'Personalizado';
  const measurement = formatMeasurement(job.w_cm, job.h_cm);
  const materialInfo = describeMaterial(job.material);
  const priceDisplay = formatCurrency(job.price_amount, job.price_currency || 'ARS');
  const ogImage = ensureImageUrl(job.preview_url || job.print_jpg_url || buildDefaultImageUrl());

  const keywords = buildKeywords([
    `mousepad gamer personalizado ${designName}`,
    materialInfo.label,
    measurement ? `mousepad ${measurement} Argentina` : '',
  ]);

  const hero = {
    eyebrow: 'Vista previa del producto',
    heading: `Mousepad gamer ${designName}`,
    subheading:
      `${materialInfo.label} producido en Argentina con impresión de alta fidelidad. Compartí el diseño con tu equipo o comunidad.`,
    stats: [
      { label: 'Material', value: materialInfo.short },
      measurement ? { label: 'Medidas', value: measurement } : null,
      priceDisplay ? { label: 'Precio estimado', value: priceDisplay } : null,
    ].filter(Boolean),
  };

  const sections = [
    {
      heading: 'Características del mousepad personalizado',
      paragraphs: [
        materialInfo.narrative,
        'El proceso de impresión garantiza colores vivos y un sellado que evita el desgaste en los bordes. Ideal para entrenamientos diarios, competencias locales y setups profesionales en Argentina.',
      ],
      list: {
        items: [
          measurement ? `Dimensiones configuradas: ${measurement}.` : 'Dimensiones personalizadas adaptadas a tu estilo.',
          'Base antideslizante y superficie balanceada para tracking con sensores ópticos modernos.',
          'Glasspad gamer personalizado o tela premium según la fricción que busques.',
        ],
      },
    },
    {
      heading: 'Beneficios para gamers en Argentina',
      paragraphs: [
        'Recibí un mousepad gamer personalizado listo para usar en torneos locales o streamings. Cada pedido se arma en Argentina para acelerar la entrega y ofrecer garantía local.',
        'Podés compartir esta vista previa en redes o enviarla a tu equipo para validar el diseño final antes de imprimir.',
      ],
    },
    {
      heading: 'Cómo completar la compra',
      paragraphs: [
        'Desde esta vista previa podés generar enlaces de checkout inmediato o agregarlo al carrito para seguir personalizando más mousepads gamers. El backend crea URLs seguras para pagar en pesos argentinos.',
      ],
    },
  ];

  const bodyHtml = renderPageLayout({ hero, sections });
  const productName = `Mousepad gamer personalizado ${designName}${measurement ? ` ${measurement}` : ''}`;
  const description = `Mousepad gamer personalizado ${designName} ${measurement ? `(${measurement})` : ''} fabricado en Argentina con ${materialInfo.label}. Ideal para esports y streamers.`;

  const jsonLd = [
    buildOrganizationJsonLd(),
    buildProductJsonLd({
      name: productName,
      description,
      image: ogImage,
      price: job.price_amount,
      currency: job.price_currency || 'ARS',
      material: materialInfo.schemaMaterial,
      availability: 'InStock',
      canonical,
      sku: job.job_id,
      width: formatNumber(job.w_cm),
      height: formatNumber(job.h_cm),
    }),
  ];

  const html = renderSeoDocument({
    title: `${productName} | MGMGAMERS Argentina`,
    description,
    canonical,
    keywords,
    ogImage,
    ogType: 'product',
    ogImageAlt: productName,
    jsonLd,
    bodyHtml,
  });

  return { status: 200, html };
}

function renderMissingProduct(jobId) {
  const canonical = canonicalUrl('/result');
  const keywords = buildKeywords(['mousepad personalizado Argentina', 'diseño no disponible']);
  const hero = {
    eyebrow: 'Mousepad no disponible',
    heading: 'El diseño solicitado ya no está publicado',
    subheading:
      'Es posible que el mousepad gamer personalizado haya sido retirado o sea privado. Podés crear uno nuevo en minutos.',
    stats: [
      { label: 'Referencia', value: jobId ? `ID: ${jobId}` : 'Sin ID proporcionado' },
    ],
  };
  const sections = [
    {
      heading: 'Creá tu propio mousepad en Argentina',
      paragraphs: [
        'Ingresá al editor para diseñar un mousepad gamer personalizado desde cero. Podés elegir entre tela o Glasspad con envíos a todo el país.',
      ],
      list: {
        items: [
          'Subí tu arte o logos en alta resolución.',
          'Configura medidas estándar o personalizadas en centímetros.',
          'Generá enlaces de checkout inmediatos para tus compras.',
        ],
      },
    },
  ];
  const bodyHtml = renderPageLayout({ hero, sections });
  const html = renderSeoDocument({
    title: 'Mousepad personalizado no disponible | MGMGAMERS',
    description: 'El mousepad gamer personalizado que buscás no está disponible. Diseñá uno nuevo con MGMGAMERS en Argentina.',
    canonical,
    keywords,
    ogImage: buildDefaultImageUrl(),
    ogImageAlt: 'Mousepad personalizado no disponible',
    jsonLd: [buildOrganizationJsonLd()],
    bodyHtml,
    noindex: true,
  });
  return { status: 404, html };
}
