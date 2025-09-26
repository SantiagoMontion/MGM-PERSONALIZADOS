import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { shopifyAdminGraphQL } from '../shopify.js';
import { ensureProductGid, resolveOnlineStorePublicationId } from '../shopify/publication.js';

const BodySchema = z.object({
  productId: z.union([z.string(), z.number()]),
}).passthrough();

function buildProductPublicationQuery(publicationId) {
  const hasPublication = Boolean(publicationId);
  const publicationVar = hasPublication ? ', $publicationId: ID!' : '';
  const publicationField = hasPublication ? 'publishedOnPublication(publicationId: $publicationId)' : '';
  return `query ProductPublicationStatus($id: ID!${publicationVar}) {
    product(id: $id) {
      id
      status
      ${publicationField}
      resourcePublications(first: 25) {
        nodes {
          publishStatus
          publication { id name }
        }
      }
    }
  }`;
}

function stripAccents(value) {
  if (typeof value !== 'string') return '';
  try {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return value;
  }
}

function isOnlineStorePublicationName(name) {
  const normalized = stripAccents(name).toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('online store')) return true;
  if (normalized.includes('tienda online')) return true;
  if (normalized.includes('tienda en linea')) return true;
  if (normalized.includes('tiendaonline')) return true;
  if (normalized.includes('tiendaenlinea')) return true;
  return normalized.includes('online') && normalized.includes('store');
}

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

    let publicationInfo = null;
    try {
      publicationInfo = await resolveOnlineStorePublicationId({ preferEnv: true });
    } catch (resolveErr) {
      try { console.warn('product_publication_status_resolve_failed', resolveErr); } catch {}
    }
    if (!publicationInfo?.id) {
      try {
        const discovered = await resolveOnlineStorePublicationId({ forceDiscover: true, preferEnv: false });
        if (discovered?.id) {
          publicationInfo = discovered;
        }
      } catch (discoverErr) {
        try { console.warn('product_publication_status_discover_failed', discoverErr); } catch {}
      }
    }

    const query = buildProductPublicationQuery(publicationInfo?.id);
    const variables = publicationInfo?.id
      ? { id: productGid, publicationId: publicationInfo.id }
      : { id: productGid };

    const resp = await shopifyAdminGraphQL(query, variables);
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

    const statusRaw = typeof product?.status === 'string' ? product.status : '';
    const statusActive = statusRaw.toUpperCase() === 'ACTIVE';

    let published = false;
    if (typeof product?.publishedOnPublication === 'boolean') {
      published = product.publishedOnPublication;
    }
    if (!published) {
      const nodes = Array.isArray(product?.resourcePublications?.nodes)
        ? product.resourcePublications.nodes
        : [];
      const resolvedPublicationId = publicationInfo?.id ? String(publicationInfo.id) : '';
      const resolvedPublicationName = publicationInfo?.name ? stripAccents(String(publicationInfo.name)).toLowerCase() : '';
      for (const node of nodes) {
        if (!node) continue;
        const publishStatus = typeof node.publishStatus === 'string' ? node.publishStatus : '';
        const nodePublication = node.publication || {};
        const nodePublicationId = nodePublication?.id ? String(nodePublication.id) : '';
        const nodePublicationNameRaw = nodePublication?.name ? String(nodePublication.name) : '';
        const nodePublicationName = stripAccents(nodePublicationNameRaw).toLowerCase();
        const matchesId = resolvedPublicationId && nodePublicationId === resolvedPublicationId;
        const matchesName = !resolvedPublicationId && resolvedPublicationName
          ? nodePublicationName === resolvedPublicationName
          : false;
        const matchesFallback = !resolvedPublicationId && !resolvedPublicationName
          ? isOnlineStorePublicationName(nodePublicationNameRaw)
          : false;
        if (matchesId || matchesName || matchesFallback) {
          if (publishStatus.toUpperCase() === 'PUBLISHED') {
            published = true;
          }
          break;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      published,
      status: statusRaw || null,
      statusActive,
      productId: product.id || productGid,
      publicationId: publicationInfo?.id || null,
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
