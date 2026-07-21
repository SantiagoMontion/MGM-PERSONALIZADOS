const EVENT_LABELS = {
  page_view: 'Vista de página',
  site_visit: 'Visita al sitio',
  home_image_uploaded: 'Subió imagen',
  home_step_edit: 'Paso edición',
  home_step_review: 'Paso revisión',
  continue_design: 'Confirmó diseño',
  home_config_open: 'Abrió configuración',
  home_tools_open: 'Abrió herramientas',
  home_add_to_cart: 'Agregó al carrito',
  home_add_private_cart: 'Compra privada',
  home_return_editor: 'Volvió al editor',
  home_restart: 'Reinició flujo',
  click_replace_image: 'Reemplazó imagen',
  mockup_view: 'Vista mockup',
  view_purchase_options: 'Opciones de compra',
  cta_click_cart: 'CTA carrito',
  cta_click_public: 'CTA público',
  cta_click_private: 'CTA privado',
  purchase_completed: 'Compra completada',
};

function humanizeEvent(name) {
  if (typeof name !== 'string' || !name) return '—';
  return EVENT_LABELS[name] || name.replace(/_/g, ' ');
}

function fmtNum(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0';
  return value.toLocaleString('es-AR');
}

function fmtPct(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0%';
  return `${value.toFixed(1)}%`;
}

function fmtDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return parsed.toLocaleString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtShortDate(value) {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return parsed.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function mdTable(headers, rows) {
  if (!rows.length) return '_Sin datos._\n';
  const escape = (cell) => String(cell ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.map(escape).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escape).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}\n`;
}

function section(title, body) {
  return `## ${title}\n\n${body.trim()}\n\n`;
}

function buildFunnelSection(homeFunnel) {
  if (!homeFunnel || typeof homeFunnel !== 'object') return '_Sin datos de embudo._\n';

  const steps = ['visit', 'upload', 'edit', 'continue', 'review', 'cart', 'purchase'];
  const rows = steps
    .filter((key) => homeFunnel[key])
    .map((key) => {
      const step = homeFunnel[key];
      const rateKeys = Object.keys(step).filter((k) => k.startsWith('rate_'));
      const dropKeys = Object.keys(step).filter((k) => k.startsWith('drop_off_'));
      const rates = rateKeys.map((k) => `${k.replace(/_/g, ' ')}: ${fmtPct(step[k])}`).join('; ');
      const drops = dropKeys.map((k) => `${k.replace(/_/g, ' ')}: ${fmtPct(step[k])}`).join('; ');
      return [
        step.label || key,
        fmtNum(step.rids),
        rates || '—',
        drops || '—',
      ];
    });

  return mdTable(['Etapa', 'Sesiones únicas', 'Tasas', 'Abandonos'], rows);
}

function eventStats(eventBreakdown, eventName) {
  const row = eventBreakdown.find((entry) => entry.event_name === eventName);
  return {
    count: row?.count ?? 0,
    unique_rids: row?.unique_rids ?? 0,
  };
}

function buildInterpretationSection(data) {
  const summary = data.summary ?? {};
  const mockupFunnel = data.mockup_funnel ?? {};
  const checkoutFunnel = data.checkout_funnel ?? {};
  const eventBreakdown = Array.isArray(data.event_breakdown) ? data.event_breakdown : [];
  const homeReview = eventStats(eventBreakdown, 'home_step_review');
  const homeCart = eventStats(eventBreakdown, 'home_add_to_cart');
  const homePrivateCart = eventStats(eventBreakdown, 'home_add_private_cart');
  const mockupView = eventStats(eventBreakdown, 'mockup_view');

  const lines = [
    'Hay **dos flujos de analytics independientes**. No confundirlos:',
    '',
    '1. **Personalizador embebido (Home, `/`)** — flujo principal en `personalizados.notmid.ar`.',
    '   Eventos: `home_image_uploaded`, `home_step_review`, `home_add_to_cart`, etc.',
    '   Las compras se confirman vía sync Shopify → `purchase_completed`.',
    '',
    '2. **Página Mockup standalone (`/mockup`)** — flujo legacy/publicación.',
    '   Eventos: `mockup_view`, `view_purchase_options`, `cta_click_*`.',
    '',
    '### Equivalencias',
    '',
    '| Etapa | Home (activo) | Mockup (legacy) |',
    '| --- | --- | --- |',
    '| Ver opciones de compra | `home_step_review` | `view_purchase_options` |',
    '| Click carrito | `home_add_to_cart` / `home_add_private_cart` | `cta_click_cart` / `cta_click_private` |',
    '| Compra registrada | `purchase_completed` (sync) | `purchase_completed` (solo si la sesión pasó por mockup) |',
    '',
  ];

  if ((summary.purchases ?? 0) > 0 && (mockupFunnel.view ?? 0) === 0) {
    lines.push(
      '### Interpretación de este período',
      '',
      `- **${fmtNum(summary.purchases)} compras** registradas en el KPI general.`,
      `- **mockup_funnel en 0** (vistas/clics): **esperado** si nadie usó la ruta `/mockup`.`,
      `- El checkout real está en **checkout_funnel / home_funnel**: revisión ${fmtNum(checkoutFunnel.review ?? summary.reached_review)}, carrito ${fmtNum(checkoutFunnel.cart ?? summary.added_to_cart)}.`,
      `- Eventos Home en el período: revisión ${fmtNum(homeReview.count)} (${fmtNum(homeReview.unique_rids)} sesiones), carrito público ${fmtNum(homeCart.count)}, carrito privado ${fmtNum(homePrivateCart.count)}, mockup_view ${fmtNum(mockupView.count)}.`,
      '',
      '**Conclusión:** no indica un bug de tracking en mockup; indica que las compras vienen del personalizador embebido, no de `/mockup`.',
      '',
    );
  }

  return lines.join('\n');
}
  if (!devices?.total) return '_Sin datos de dispositivos._\n';

  const funnelRows = [
    ['Visitas', devices.mobile?.visitors, devices.desktop?.visitors],
    ['Subieron imagen', devices.mobile?.uploads, devices.desktop?.uploads],
    ['Llegaron a revisión', devices.mobile?.reached_review, devices.desktop?.reached_review],
    ['Agregaron al carrito', devices.mobile?.added_to_cart, devices.desktop?.added_to_cart],
    ['Compras completadas', devices.mobile?.purchases, devices.desktop?.purchases],
    ['Conv. visita → compra', fmtPct(devices.mobile?.completion_rate), fmtPct(devices.desktop?.completion_rate)],
    ['Tasa subida imagen', fmtPct(devices.mobile?.upload_rate), fmtPct(devices.desktop?.upload_rate)],
    ['Tasa carrito (desde revisión)', fmtPct(devices.mobile?.cart_rate), fmtPct(devices.desktop?.cart_rate)],
  ];

  let body = `**Total visitantes:** ${fmtNum(devices.total)} · **Compras:** ${fmtNum(devices.purchases_total)} · **Carritos:** ${fmtNum(devices.cart_total)}\n\n`;
  body += mdTable(['Métrica', 'Celular', 'PC'], funnelRows);

  if (devices.cart_split) {
    body += `\n**Reparto carritos:** ${fmtNum(devices.cart_split.mobile)} celular (${fmtPct(devices.cart_split.mobile_percent)}) · ${fmtNum(devices.cart_split.desktop)} PC (${fmtPct(devices.cart_split.desktop_percent)})\n`;
  }
  if (devices.completion_split) {
    body += `**Reparto compras:** ${fmtNum(devices.completion_split.mobile)} celular (${fmtPct(devices.completion_split.mobile_percent)}) · ${fmtNum(devices.completion_split.desktop)} PC (${fmtPct(devices.completion_split.desktop_percent)})\n`;
  }

  return body;
}

/**
 * Genera un reporte Markdown completo del dashboard, pensado para subir a una IA.
 */
export function buildAnalyticsReportMarkdown(data, { rangeDays, exportedAt = new Date() } = {}) {
  if (!data?.ok) {
    throw new Error('No hay datos de analytics para exportar.');
  }

  const summary = data.summary ?? {};
  const dailyVisits = Array.isArray(data.daily_visits) ? data.daily_visits : [];
  const eventBreakdown = Array.isArray(data.event_breakdown) ? data.event_breakdown : [];
  const topMaterials = Array.isArray(data.top_materials) ? data.top_materials : [];
  const topSizes = Array.isArray(data.top_sizes) ? data.top_sizes : [];
  const topMaterialSizes = Array.isArray(data.top_material_sizes) ? data.top_material_sizes : [];
  const topPaths = Array.isArray(data.top_paths) ? data.top_paths : [];
  const purchasesDetail = Array.isArray(data.purchases_detail) ? data.purchases_detail : [];
  const lastEvents = Array.isArray(data.last_events) ? data.last_events : [];
  const mockupFunnel = data.mockup_funnel ?? {};
  const homeFunnel = data.home_funnel ?? {};
  const checkoutFunnel = data.checkout_funnel ?? {};
  const devices = data.devices ?? null;
  const exportedIso = exportedAt.toISOString();

  const lines = [];

  lines.push('# Reporte Analytics · NOTMID Personalizador\n');
  lines.push('> **Para IA:** Métricas del configurador de mousepads (notmid.ar / personalizados.notmid.ar). **Leé primero «Contexto e interpretación»**: hay dos embudos (Home vs /mockup). Las compras del KPI principal suelen venir del Home embebido, no de mockup_funnel. No diagnosticar bug si mockup_funnel=0 y hay compras.\n');

  lines.push('## Metadatos del reporte\n');
  lines.push(`- **Período seleccionado:** últimos **${rangeDays} días**`);
  lines.push(`- **Ventana:** ${fmtDateTime(data.from)} → ${fmtDateTime(data.to)}`);
  lines.push(`- **Exportado:** ${fmtDateTime(exportedIso)}`);
  lines.push(`- **ID diagnóstico API:** ${data.diagId || '—'}`);
  if (data.warning) {
    lines.push(`- **Advertencia:** ${data.warning}${data.warning_detail ? ` — ${data.warning_detail}` : ''}`);
  }
  lines.push('');

  lines.push(section('Contexto e interpretación (leer primero)', buildInterpretationSection(data)));

  lines.push(section('Resumen ejecutivo (KPIs)', [
    `- **Visitantes únicos:** ${fmtNum(summary.unique_visitors)}`,
    `- **Subieron imagen:** ${fmtNum(summary.uploads)} (tasa ${fmtPct(summary.upload_rate)} desde visita)`,
    `- **Llegaron a revisión:** ${fmtNum(summary.reached_review)}`,
    `- **Agregaron al carrito:** ${fmtNum(summary.added_to_cart)} (tasa ${fmtPct(summary.cart_rate)} desde revisión)`,
    `- **Compras completadas:** ${fmtNum(summary.purchases)} (conversión global ${fmtPct(summary.completion_rate)} visita → compra)`,
  ].join('\n')));

  lines.push(section('Embudo Home (personalizador embebido, ruta /)', buildFunnelSection(homeFunnel)));

  lines.push(section('Checkout embebido (resumen)', [
    `- **Paso revisión (home_step_review):** ${fmtNum(checkoutFunnel.review ?? summary.reached_review)} sesiones`,
    `- **Agregaron al carrito:** ${fmtNum(checkoutFunnel.cart ?? summary.added_to_cart)} (tasa desde revisión ${fmtPct(checkoutFunnel.rate_review_to_cart ?? summary.cart_rate)})`,
    `- **Compras completadas:** ${fmtNum(checkoutFunnel.purchases ?? summary.purchases)} (conversión visita→compra ${fmtPct(checkoutFunnel.rate_visit_to_purchase ?? summary.completion_rate)})`,
  ].join('\n')));

  lines.push(section('Embudo Mockup (solo ruta /mockup, legacy)', [
    `- **Vistas mockup (\`mockup_view\`):** ${fmtNum(mockupFunnel.view)}`,
    `- **Opciones de compra (\`view_purchase_options\`):** ${fmtNum(mockupFunnel.options)}`,
    `- **Clicks CTA:** ${fmtNum(mockupFunnel.clicks)}`,
    `- **Compras atribuidas a sesión mockup:** ${fmtNum(mockupFunnel.purchase)}`,
    '',
    '_Si todo está en 0 pero hay compras en el KPI general, es normal: las compras vienen del Home embebido._',
  ].join('\n')));

  lines.push(section(
    'Visitas por día',
    mdTable(
      ['Fecha', 'Visitantes únicos', 'Vistas de página'],
      dailyVisits.map((row) => [fmtShortDate(row.date), fmtNum(row.visitors), fmtNum(row.page_views)]),
    ),
  ));

  lines.push(section(
    'Eventos (todos)',
    mdTable(
      ['Evento', 'Nombre técnico', 'Total', 'Sesiones únicas'],
      eventBreakdown.map((row) => [
        humanizeEvent(row.event_name),
        row.event_name,
        fmtNum(row.count),
        fmtNum(row.unique_rids),
      ]),
    ),
  ));

  lines.push(section('Dispositivos: Celular vs PC', buildDeviceSection(devices)));

  lines.push(section(
    'Materiales más elegidos',
    topMaterials.length
      ? mdTable(['Material', 'Veces'], topMaterials.map((r) => [r.material, fmtNum(r.count)]))
      : '_Sin datos._',
  ));

  lines.push(section(
    'Medidas más elegidas',
    topSizes.length
      ? mdTable(['Medida', 'Veces'], topSizes.map((r) => [r.size, fmtNum(r.count)]))
      : '_Sin datos._',
  ));

  lines.push(section(
    'Combinaciones material + medida',
    topMaterialSizes.length
      ? mdTable(['Combinación', 'Veces'], topMaterialSizes.map((r) => [r.label, fmtNum(r.count)]))
      : '_Sin datos._',
  ));

  lines.push(section(
    'Rutas más visitadas',
    topPaths.length
      ? mdTable(['Ruta', 'Vistas'], topPaths.map((r) => [r.path, fmtNum(r.views)]))
      : '_Sin datos._',
  ));

  lines.push(section(
    'Detalle de compras',
    purchasesDetail.length
      ? mdTable(
        ['Pedido', 'Order ID', 'Total', 'Origen', 'Sesión (rid)', 'Fecha'],
        purchasesDetail.map((row) => [
          row.order_name || '—',
          row.order_id || '—',
          row.total_price ? `$${row.total_price}` : '—',
          row.source || '—',
          row.rid || '—',
          fmtDateTime(row.created_at),
        ]),
      )
      : '_No hay compras registradas en este período._',
  ));

  if (data.purchase_sync) {
    lines.push(section('Sync de compras (Shopify)', `\`\`\`json\n${JSON.stringify(data.purchase_sync, null, 2)}\n\`\`\``));
  }

  lines.push(section(
    'Actividad reciente (últimos eventos)',
    lastEvents.length
      ? mdTable(
        ['Evento', 'Nombre técnico', 'Sesión (rid)', 'Slug', 'Fecha'],
        lastEvents.map((row) => [
          humanizeEvent(row.event_name),
          row.event_name,
          row.rid || '—',
          row.design_slug || '—',
          fmtDateTime(row.created_at),
        ]),
      )
      : '_Sin actividad reciente._',
  ));

  lines.push('## Datos crudos (JSON)\n');
  lines.push('> Anexo con el payload completo del dashboard para análisis programático.\n');
  lines.push('```json');
  lines.push(JSON.stringify(data, null, 2));
  lines.push('```\n');

  return lines.join('\n');
}

function buildExportFilename(rangeDays, exportedAt = new Date()) {
  const stamp = exportedAt.toISOString().slice(0, 10);
  return `notmid-analytics-${rangeDays}d-${stamp}.md`;
}

/**
 * Descarga el reporte Markdown en el navegador.
 */
export function downloadAnalyticsReport(data, { rangeDays, exportedAt = new Date() } = {}) {
  const markdown = buildAnalyticsReportMarkdown(data, { rangeDays, exportedAt });
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildExportFilename(rangeDays, exportedAt);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return link.download;
}

export default {
  buildAnalyticsReportMarkdown,
  downloadAnalyticsReport,
};
