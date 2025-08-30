import crypto from 'node:crypto';
import { supa } from '../../lib/supa.js';
import { shopifyAdmin } from '../../lib/shopify.js';

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));


  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  try {
    const { job_id } = req.body || {};
    if (!job_id) return res.status(400).json({ error: 'missing_job_id' });

    const { data: job, error } = await supa.from('jobs').select('*').eq('job_id', job_id).single();
    if (error || !job) return res.status(404).json({ error: 'job_not_found' });
    if (!job.shopify_product_id) return res.status(409).json({ error: 'missing_product_id' });

    await shopifyAdmin(`/products/${job.shopify_product_id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ product: { id: job.shopify_product_id, status: 'active' } })
    });

    const { product } = await shopifyAdmin(`/products/${job.shopify_product_id}.json`, { method: 'GET' });
    const pubBase = process.env.SHOPIFY_PUBLIC_BASE || `https://${process.env.SHOPIFY_STORE_DOMAIN}`;
    const productUrl = `${pubBase}/products/${product.handle}`;

    await supa.from('jobs').update({ shopify_product_url: productUrl }).eq('id', job.id);

    return res.status(200).json({ ok: true, job_id: job.job_id, product_url: productUrl });
  } catch (e) {
    console.error('publish_product_error', e);
    return res.status(500).json({ error: 'publish_product_failed', detail: String(e?.message || e) });
  }
}
