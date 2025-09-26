import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { shopifyAdminGraphQL } from '../shopify.js';
import { ensureProductGid } from '../shopify/publication.js';

const BodySchema = z.object({
  productId: z.union([z.string(), z.number()]),
}).passthrough();

const PRODUCT_PUBLICATION_QUERY = `query ProductPublicationStatus($id: ID!) {
  product(id: $id) {
    id
    publishedOnCurrentPublication
  }
}`;

export default async function productPublicationStatus(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const body = await parseJsonBody(req).catch((err) => {
      if (err?.code === 'payload_too_large') {
        if (typeof res.status === 'function') res.status(413); else res.statusCode = 413;
        throw err;
      }
      if (err?.code === 'invalid_json') {
        if (typeof res.status === 'function') res.status(400); else res.statusCode = 400;
        throw err;
      }
      throw err;
    });
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'invalid_body', issues: parsed.error.flatten().fieldErrors });
    }
    const { productId } = parsed.data;
    const productGid = ensureProductGid(productId);
    if (!productGid) {
      return res.status(400).json({ ok: false, error: 'invalid_product' });
    }

    const resp = await shopifyAdminGraphQL(PRODUCT_PUBLICATION_QUERY, { id: productGid });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      return res.status(502).json({ ok: false, error: 'publication_status_failed', status: resp.status, detail: json });
    }
    if (Array.isArray(json?.errors) && json.errors.length) {
      return res.status(502).json({ ok: false, error: 'publication_status_failed', detail: json.errors });
    }
    const product = json?.data?.product;
    if (!product) {
      return res.status(404).json({ ok: false, error: 'product_not_found' });
    }

    const published = product?.publishedOnCurrentPublication === true;

    return res.status(200).json({
      ok: true,
      published,
      productId: product.id || productGid,
    });
  } catch (err) {
    if (res.statusCode === 413) {
      return res.json({ ok: false, error: 'payload_too_large' });
    }
    if (res.statusCode === 400) {
      return res.json({ ok: false, error: 'invalid_json' });
    }
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return res.status(400).json({ ok: false, error: 'shopify_env_missing', missing: err?.missing });
    }
    console.error('product_publication_status_error', err);
    return res.status(500).json({ ok: false, error: 'product_publication_status_failed' });
  }
}
