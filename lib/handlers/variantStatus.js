import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { shopifyStorefrontGraphQL } from '../shopify.js';
import {
  ensureProductGid,
  ensureVariantGid,
} from '../shopify/publication.js';

const BodySchema = z.object({
  variantId: z.union([z.string(), z.number()]),
  productId: z.union([z.string(), z.number()]),
}).passthrough();

const PRODUCT_VARIANT_QUERY = `query ProductVariantAvailability($productId: ID!, $first: Int!) {
  product(id: $productId) {
    id
    variants(first: $first) {
      nodes {
        id
        availableForSale
      }
    }
  }
}`;

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
    const { variantId, productId } = parsed.data;
    const variantGid = ensureVariantGid(variantId);
    if (!variantGid) {
      return res.status(400).json({ ok: false, error: 'invalid_variant' });
    }
    const productGid = ensureProductGid(productId);
    if (!productGid) {
      return res.status(400).json({ ok: false, error: 'invalid_product' });
    }

    const resp = await shopifyStorefrontGraphQL(PRODUCT_VARIANT_QUERY, {
      productId: productGid,
      first: 10,
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      return res.status(502).json({ ok: false, error: 'variant_status_failed', status: resp.status, detail: json });
    }
    if (Array.isArray(json?.errors) && json.errors.length) {
      return res.status(502).json({ ok: false, error: 'variant_status_failed', detail: json.errors });
    }
    const product = json?.data?.product;
    if (!product) {
      return res.status(404).json({ ok: false, error: 'product_not_found' });
    }

    const nodes = Array.isArray(product?.variants?.nodes) ? product.variants.nodes : [];
    const match = nodes.find((node) => ensureVariantGid(node?.id) === variantGid) || null;
    const variantPresent = Boolean(match);
    const available = match?.availableForSale === true;
    const ready = Boolean(variantPresent && available);

    return res.status(200).json({
      ok: true,
      ready,
      available,
      published: variantPresent,
      variantPresent,
      productId: product.id,
      variantId: match?.id || variantGid,
      variantCount: nodes.length,
      source: 'storefront',
    });
  } catch (err) {
    if (res.statusCode === 413) {
      return res.json({ ok: false, error: 'payload_too_large' });
    }
    if (res.statusCode === 400) {
      return res.json({ ok: false, error: 'invalid_json' });
    }
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return res.status(400).json({ ok: false, error: 'shopify_storefront_env_missing', missing: err?.missing });
    }
    console.error('variant_status_error', err);
    return res.status(500).json({ ok: false, error: 'variant_status_failed' });
  }
}
