import { supa } from '../lib/supa.js';
import { shopifyAdmin } from '../lib/shopify.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const { job_id } = req.body || {};
    if (!job_id) return res.status(400).json({ error: 'missing_job_id' });

    const { data: job, error } = await supa.from('jobs').select('*').eq('job_id', job_id).single();
    if (error || !job) return res.status(404).json({ error: 'job_not_found' });
    if (!job.print_jpg_url || !job.pdf_url) return res.status(409).json({ error: 'assets_not_ready' });
    if (!job.price_amount || job.price_amount <= 0) return res.status(400).json({ error: 'invalid_price' });

    const lineItemTitle = `Mousepad Personalizado — ${job.material} ${Number(job.w_cm)}x${Number(job.h_cm)} cm`;
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

    const { draft_order } = await shopifyAdmin(`/draft_orders.json`, { method: 'POST', body: JSON.stringify(payload) });
    if (!draft_order?.invoice_url) throw new Error('no_invoice_url');

    await supa.from('jobs').update({
      checkout_url: draft_order.invoice_url,
      shopify_draft_id: String(draft_order.id),
      status: 'SHOPIFY_CREATED'
    }).eq('id', job.id);

    res.status(200).json({ ok: true, job_id: job.job_id, checkout_url: draft_order.invoice_url });
  } catch (e) {
    console.error('create_checkout_error', e);
    res.status(500).json({ error: 'create_checkout_failed', detail: String(e?.message || e) });
  }
}
