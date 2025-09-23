import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { shopifyAdminGraphQL } from '../shopify.js';
import {
  ensureProductGid,
  ensureVariantGid,
  getOnlineStorePublicationId,
} from '../shopify/publication.js';

const BodySchema = z.object({
  variantId: z.union([z.string(), z.number()]),
  productId: z.union([z.string(), z.number()]).optional(),
  publicationId: z.string().optional(),
}).passthrough();

function buildQuery(includePublication) {
  const publicationVar = includePublication ? ', $publicationId: ID!' : '';
  const publicationArg = includePublication ? '(publicationId: $publicationId)' : '';
  return `query VariantPublicationStatus($variantId: ID!${publicationVar}) {
    productVariant(id: $variantId) {
      id
      availableForSale
      currentlyNotInStock
      inventoryQuantity
      publishedOnCurrentPublication
      ${includePublication ? `publishedOnPublication${publicationArg}` : ''}
      product {
        id
        status
        publishedAt
        publishedOnCurrentPublication
        ${includePublication ? `publishedOnPublication${publicationArg}` : ''}
      }
    }
  }`;
}

function interpretPublicationFlags(entity, includePublication) {
  if (!entity || typeof entity !== 'object') return { published: false };
  const flags = [];
  if (entity.publishedOnCurrentPublication === true) flags.push(true);
  if (includePublication && entity.publishedOnPublication === true) flags.push(true);
  if (entity.publishedAt) flags.push(true);
  return { published: flags.some(Boolean) };
}

export default async function variantStatus(req, res) {
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
    const { variantId, productId, publicationId: overridePublicationId } = parsed.data;
    const variantGid = ensureVariantGid(variantId);
    if (!variantGid) {
      return res.status(400).json({ ok: false, error: 'invalid_variant' });
    }

    let publicationId = overridePublicationId?.trim() || '';
    if (!publicationId) {
      try {
        publicationId = await getOnlineStorePublicationId();
      } catch (err) {
        if (err?.message === 'SHOPIFY_ENV_MISSING' || err?.message === 'online_store_publication_missing') {
          publicationId = '';
        } else {
          throw err;
        }
      }
    }

    const includePublication = Boolean(publicationId);
    const query = buildQuery(includePublication);
    const variables = includePublication
      ? { variantId: variantGid, publicationId }
      : { variantId: variantGid };

    const resp = await shopifyAdminGraphQL(query, variables);
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      return res.status(502).json({ ok: false, error: 'variant_status_failed', status: resp.status, detail: json });
    }
    const variant = json?.data?.productVariant;
    if (!variant) {
      return res.status(404).json({ ok: false, error: 'variant_not_found' });
    }

    const product = variant.product || (productId ? { id: ensureProductGid(productId) } : null);
    const variantPublication = interpretPublicationFlags(variant, includePublication);
    const productPublication = interpretPublicationFlags(product, includePublication);
    const published = variantPublication.published || productPublication.published;
    const available = variant.availableForSale === true && variant.currentlyNotInStock !== true;
    const ready = Boolean(published && available);

    return res.status(200).json({
      ok: true,
      ready,
      published,
      available,
      variantPublished: Boolean(variantPublication.published),
      productPublished: Boolean(productPublication.published),
      productStatus: product?.status || null,
      productId: product?.id || null,
      productPublishedAt: product?.publishedAt || null,
      publicationId: publicationId || null,
      variantId: variantGid,
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
    console.error('variant_status_error', err);
    return res.status(500).json({ ok: false, error: 'variant_status_failed' });
  }
}
