// /api/create-checkout.js
import { randomUUID } from 'node:crypto';
import { supa } from '../../lib/supa.js';
import { shopifyAdmin } from '../../lib/shopify.js';
import { cors } from '../lib/cors.js';

async function getInvoiceUrl(draftId) {
  // lee el draft y devuelve invoice_url si existe
  const { draft_order } = await shopifyAdmin(`/draft_orders/${draftId}.json`, { method: 'GET' });
  return draft_order?.invoice_url || null;
}

export default async function handler(req, res) {
  const diagId = randomUUID?.() || Date.now().toString();
  res.setHeader('X-Diag-Id', diagId);
  if (cors(req, res)) return;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  try {
    const { job_id } = req.body || {};
    if (!job_id) return res.status(400).json({ error: 'missing_job_id' });

    // 1) Traer job
    const { data: job, error } = await supa.from('jobs').select('*').eq('job_id', job_id).single();
    if (error || !job) return res.status(404).json({ error: 'job_not_found' });
    if (!job.print_jpg_url || !job.pdf_url) return res.status(409).json({ error: 'assets_not_ready' });
    if (!job.price_amount || job.price_amount <= 0) return res.status(400).json({ error: 'invalid_price' });

    // 2) Crear Draft Order
    const lineItemTitle = `Mousepad "${job.design_name || 'Diseño'}" Medida ${Number(job.w_cm)}x${Number(job.h_cm)} cm ${job.material} | PERSONALIZADO`;
    const properties = [
      { name: 'jobId', value: job.job_id },
      { name: 'material', value: job.material },
      { name: 'size_cm', value: `${Number(job.w_cm)}x${Number(job.h_cm)}` },
      { name: 'print_jpg_url', value: job.print_jpg_url },
      { name: 'pdf_url', value: job.pdf_url },
      { name: 'preview_url', value: job.preview_url || '' },
      { name: 'dpi', value: String(job.dpi || '') },
      { name: 'dpi_level', value: job.dpi_level || '' },
      { name: 'low_quality_ack', value: String(!!job.low_quality_ack) }
    ];

    const payload = {
      draft_order: {
        line_items: [{ title: lineItemTitle, quantity: 1, price: Number(job.price_amount).toFixed(2), properties }],
        customer: job.customer_email ? { email: job.customer_email } : undefined,
        note: job.notes || undefined,
        use_customer_default_address: true
      }
    };

    const { draft_order } = await shopifyAdmin(`/draft_orders.json`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const draftId = draft_order?.id;
    if (!draftId) throw new Error('draft_create_failed');

    // 3) Obtener invoice_url (reintento corto)
    let invoiceUrl = await getInvoiceUrl(draftId);

    // 4) Si no hay invoice_url, forzar con send_invoice y reintentar
    if (!invoiceUrl) {
      const toEmail = job.customer_email || 'orders@' + (process.env.SHOPIFY_STORE_DOMAIN || 'example.com');
      await shopifyAdmin(`/draft_orders/${draftId}/send_invoice.json`, {
        method: 'POST',
        body: JSON.stringify({
          draft_order_invoice: {
            to: toEmail,
            custom_message: 'Link de pago de tu personalizado'
          }
        })
      });
      // pequeño polling 2x
      for (let i = 0; i < 2 && !invoiceUrl; i++) {
        await new Promise(r => setTimeout(r, 800));
        invoiceUrl = await getInvoiceUrl(draftId);
      }
    }

    if (!invoiceUrl) throw new Error('no_invoice_url');

    // 5) Guardar en DB
    await supa.from('jobs').update({
      checkout_url: invoiceUrl,
      shopify_draft_id: String(draftId),
      status: 'SHOPIFY_CREATED'
    }).eq('id', job.id);

    return res.status(200).json({ ok: true, job_id: job.job_id, checkout_url: invoiceUrl });

  } catch (e) {
    console.error('create_checkout_error', e);
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    return res.status(500).json({
      error: 'create_checkout_failed',
      detail: String(e?.message || e),
      domain: process.env.SHOPIFY_STORE_DOMAIN || null
    });
  }
}
