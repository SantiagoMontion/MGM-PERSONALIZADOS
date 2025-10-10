import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { shopifyAdminGraphQL } from '../shopify.js';
import {
  ensureProductGid,
  overrideOnlineStorePublicationId,
  publishToOnlineStore,
  resolveOnlineStorePublicationId,
} from '../shopify/publication.js';
import logger from '../_lib/logger.js';

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

function isPublicationMissingError(err) {
  if (!err || typeof err !== 'object') return false;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (message && message.includes('publication') && (message.includes('missing') || message.includes('not found') || message.includes('invalid'))) {
    return true;
  }
  const code = typeof err.code === 'string' ? err.code.toLowerCase()
    : typeof err.extensions?.code === 'string' ? err.extensions.code.toLowerCase() : '';
  if (code && code.includes('publication')) {
    return true;
  }
  return false;
}

function detectPublicationMissing(errors) {
  if (!Array.isArray(errors)) return false;
  return errors.some((err) => isPublicationMissingError(err));
}

async function loadPublicationStatus(productGid, publicationId) {
  const query = buildQuery(publicationId);
  const variables = publicationId ? { id: productGid, publicationId } : { id: productGid };
  try {
    const resp = await shopifyAdminGraphQL(query, variables);
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      return { ok: false, status: resp.status, json };
    }
    const errors = Array.isArray(json?.errors) ? json.errors : [];
    if (errors.length) {
      if (detectPublicationMissing(errors)) {
        return { ok: false, missingPublication: true, json };
      }
      return { ok: false, errors, json };
    }
    const product = json?.data?.product;
    if (!product) {
      return { ok: false, productNotFound: true, json };
    }
    return {
      ok: true,
      published: interpretPublicationStatus(product, publicationId),
      product,
      json,
    };
  } catch (err) {
    return { ok: false, exception: err };
  }
}

export default async function ensureProductPublication(req, res) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
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

    const meta = {
      recoveries: [],
      publishAttempts: 0,
      publicationIdSource: '',
      publicationId: null,
    };

    const overrideNormalized = typeof overridePublicationId === 'string'
      ? overridePublicationId.trim()
      : '';
    let publicationInfo = overrideNormalized
      ? { id: overrideNormalized, source: 'override' }
      : null;

    if (!publicationInfo) {
      try {
        const resolved = await resolveOnlineStorePublicationId({ preferEnv: true });
        if (resolved?.id) {
          publicationInfo = resolved;
        }
      } catch (err) {
        if (err?.message === 'online_store_publication_missing') {
          meta.recoveries.push('publication_missing_detected');
        } else {
          throw err;
        }
      }

      if (!publicationInfo?.id) {
        try {
          const discovered = await resolveOnlineStorePublicationId({ forceDiscover: true, preferEnv: false });
          if (discovered?.id) {
            publicationInfo = discovered;
            meta.recoveries.push('publication_id_discovered');
          }
        } catch (err) {
          if (err?.message === 'online_store_publication_missing') {
            meta.recoveries.push('publication_missing_detected');
          } else {
            throw err;
          }
        }
      }
    }

    if (!publicationInfo?.id) {
      return res.status(502).json({ ok: false, error: 'publication_missing', recoveries: meta.recoveries });
    }

    overrideOnlineStorePublicationId(publicationInfo.id, publicationInfo.source || 'runtime');
    meta.publicationIdSource = publicationInfo.source || 'unknown';
    meta.publicationId = publicationInfo.id;

    let statusResult = await loadPublicationStatus(productGid, publicationInfo.id);

    if (!statusResult.ok && statusResult.missingPublication) {
      meta.recoveries.push('publication_missing_detected');
      try { logger.warn('ensure_product_publication_missing', { stage: 'status', publicationId: publicationInfo.id }); } catch {}
      const recovered = await resolveOnlineStorePublicationId({ forceDiscover: true, preferEnv: false });
      if (recovered?.id && recovered.id !== publicationInfo.id) {
        overrideOnlineStorePublicationId(recovered.id, recovered.source || 'discovered');
        publicationInfo = recovered;
        meta.publicationIdSource = recovered.source || 'discovered';
        meta.publicationId = recovered.id;
        statusResult = await loadPublicationStatus(productGid, publicationInfo.id);
      }
    }

    if (!statusResult.ok && statusResult.missingPublication) {
      return res.status(502).json({
        ok: false,
        error: 'publication_missing',
        recoveries: meta.recoveries,
        detail: statusResult.json || null,
      });
    }

    if (!statusResult.ok) {
      if (statusResult.productNotFound) {
        return res.status(404).json({ ok: false, error: 'product_not_found' });
      }
      if (statusResult.exception) {
        throw statusResult.exception;
      }
      return res.status(502).json({
        ok: false,
        error: 'publication_status_failed',
        status: statusResult.status || null,
        detail: statusResult.json || statusResult.errors || null,
      });
    }

    if (statusResult.published) {
      return res.status(200).json({
        ok: true,
        published: true,
        publicationId: publicationInfo.id,
        productId: productGid,
        publicationIdSource: meta.publicationIdSource,
        recoveries: meta.recoveries,
        publishAttempts: meta.publishAttempts,
      });
    }

    let publishResult = await publishToOnlineStore(productGid, publicationInfo.id, {
      maxAttempts: 5,
      initialDelayMs: 200,
      maxDelayMs: 3200,
      preferEnv: publicationInfo.source === 'env' || publicationInfo.source === 'override',
    });
    meta.publishAttempts += publishResult?.attempt || 0;

    if (!publishResult.ok && publishResult.reason === 'publication_missing') {
      meta.recoveries.push('publication_missing_detected');
      try { logger.warn('ensure_product_publication_missing', { stage: 'publish', publicationId: publicationInfo.id }); } catch {}
      const recovered = await resolveOnlineStorePublicationId({ forceDiscover: true, preferEnv: false });
      if (recovered?.id && recovered.id !== publicationInfo.id) {
        overrideOnlineStorePublicationId(recovered.id, recovered.source || 'discovered');
        publicationInfo = recovered;
        meta.publicationIdSource = recovered.source || 'discovered';
        meta.publicationId = recovered.id;
      }
      publishResult = await publishToOnlineStore(productGid, publicationInfo.id, {
        maxAttempts: 5,
        initialDelayMs: 200,
        maxDelayMs: 3200,
        preferEnv: false,
      });
      meta.publishAttempts += publishResult?.attempt || 0;
    }

    if (!publishResult.ok) {
      return res.status(502).json({
        ok: false,
        error: publishResult.reason || 'publish_failed',
        detail: publishResult,
        recoveries: meta.recoveries,
        publicationId: publicationInfo.id,
      });
    }

    const verifyResult = await loadPublicationStatus(productGid, publicationInfo.id);
    const responseBody = {
      ok: true,
      published: Boolean(verifyResult.ok ? verifyResult.published : false),
      publicationId: publicationInfo.id,
      productId: productGid,
      publicationIdSource: meta.publicationIdSource,
      recoveries: meta.recoveries,
      publishAttempts: meta.publishAttempts,
    };

    if (!verifyResult.ok) {
      responseBody.published = false;
      if (verifyResult.missingPublication) {
        meta.recoveries.push('publication_missing_detected');
      }
      responseBody.verification = {
        status: verifyResult.status || null,
        missingPublication: Boolean(verifyResult.missingPublication),
        productNotFound: Boolean(verifyResult.productNotFound),
        errors: verifyResult.errors || null,
        detail: verifyResult.json || null,
      };
      if (verifyResult.exception) {
        responseBody.verification.exception = verifyResult.exception?.message || String(verifyResult.exception);
      }
    }

    return res.status(200).json(responseBody);
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
    logger.error('ensure_product_publication_error', err);
    return res.status(500).json({ ok: false, error: 'ensure_publication_failed' });
  }
}
