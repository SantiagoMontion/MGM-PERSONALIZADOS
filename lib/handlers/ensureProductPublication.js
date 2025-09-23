import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { shopifyAdminGraphQL } from '../shopify.js';
import {
  ensureProductGid,
  getOnlineStorePublicationId,
  publishToOnlineStore,
} from '../shopify/publication.js';

const BodySchema = z.object({
  productId: z.union([z.string(), z.number()]),
  publicationId: z.string().optional(),
}).passthrough();

function buildQuery(publicationId) {
  const hasPublication = Boolean(publicationId);
  const publicationVar = hasPublication ? ', $publicationId: ID!' : '';
  const publicationField = hasPublication
    ? 'publishedOnPublication(publicationId: $publicationId)'
    : '';
  return `query ProductPublicationStatus($id: ID!${publicationVar}) {
    product(id: $id) {
      id
      status
      publishedAt
      publishedOnCurrentPublication
      ${publicationField}
    }
  }`;
}

function interpretPublicationStatus(product, publicationId) {
  if (!product || typeof product !== 'object') return false;
  if (product.publishedAt) return true;
  if (product.publishedOnCurrentPublication === true) return true;
  if (publicationId && product.publishedOnPublication === true) return true;
  return false;
}

export default async function ensureProductPublication(req, res) {
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
    const { productId, publicationId: overridePublicationId } = parsed.data;
    const productGid = ensureProductGid(productId);
    if (!productGid) {
      return res.status(400).json({ ok: false, error: 'invalid_product' });
    }

    let publicationId = overridePublicationId?.trim();
    if (!publicationId) {
      publicationId = await getOnlineStorePublicationId();
    }
    if (!publicationId) {
      return res.status(502).json({ ok: false, error: 'publication_missing' });
    }

    const query = buildQuery(publicationId);
    const variables = publicationId ? { id: productGid, publicationId } : { id: productGid };
    const statusResp = await shopifyAdminGraphQL(query, variables);
    const statusJson = await statusResp.json().catch(() => null);
    if (!statusResp.ok) {
      return res.status(502).json({ ok: false, error: 'publication_status_failed', status: statusResp.status, detail: statusJson });
    }
    const product = statusJson?.data?.product;
    if (!product) {
      return res.status(404).json({ ok: false, error: 'product_not_found' });
    }
    const alreadyPublished = interpretPublicationStatus(product, publicationId);
    if (alreadyPublished) {
      return res.status(200).json({ ok: true, published: true, publicationId });
    }

    await publishToOnlineStore(productGid, publicationId);

    let finalPublished = true;
    try {
      const verifyResp = await shopifyAdminGraphQL(query, variables);
      const verifyJson = await verifyResp.json().catch(() => null);
      if (verifyResp.ok) {
        const verifyProduct = verifyJson?.data?.product;
        finalPublished = interpretPublicationStatus(verifyProduct, publicationId);
      }
    } catch (err) {
      console.error('ensure_product_publication_verify_failed', err);
    }

    return res.status(200).json({ ok: true, published: finalPublished, publicationId });
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return res.status(400).json({ ok: false, error: 'shopify_env_missing', missing: err?.missing });
    }
    if (err?.message === 'online_store_publication_missing') {
      return res.status(502).json({ ok: false, error: 'publication_missing' });
    }
    if (res.statusCode === 413) {
      return res.json({ ok: false, error: 'payload_too_large' });
    }
    if (res.statusCode === 400) {
      return res.json({ ok: false, error: 'invalid_json' });
    }
    console.error('ensure_product_publication_error', err);
    return res.status(500).json({ ok: false, error: 'ensure_publication_failed' });
  }
}
