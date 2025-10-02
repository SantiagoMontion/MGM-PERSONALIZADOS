import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { buildOnlineStorePermalinkFromGid, idVariantGidToNumeric } from '../shopify/permalinks.js';
import { getPublicStorefrontBase } from '../publicStorefront.js';

const BodySchema = z
  .object({
    cartId: z.string(),
    variantGid: z.string(),
    quantity: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.floor(raw));
}

function respond(res, status, payload, logLabel = '[cart_add_response]') {
  const body = JSON.stringify(payload ?? {});
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  const contentType = 'application/json; charset=utf-8';
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', contentType);
  }
  if (typeof res.send === 'function') {
    res.send(body);
  } else {
    res.end(body);
  }
  try {
    console.info(logLabel, { status, contentType });
  } catch (loggingErr) {
    if (loggingErr) {
      // noop
    }
  }
}

export default async function cartAdd(req, res) {
  try {
    console.info('[cart_add_request]', { method: req.method, path: req.url || '' });
  } catch (loggingErr) {
    if (loggingErr) {
      // noop
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    const status = err?.code === 'payload_too_large' ? 413 : err?.code === 'invalid_json' ? 400 : 400;
    return respond(res, status, { ok: false, error: err?.code || 'invalid_body' });
  }
  const parsed = BodySchema.safeParse(body || {});
  if (!parsed.success) {
    return respond(res, 400, { ok: false, error: 'invalid_body' });
  }
  const { cartId, variantGid, quantity } = parsed.data;
  if (!variantGid.startsWith('gid://shopify/ProductVariant/')) {
    return respond(res, 400, { ok: false, error: 'invalid_variant_gid' });
  }
  const normalizedQuantity = normalizeQuantity(quantity ?? 1);
  const permalink = buildOnlineStorePermalinkFromGid({
    variantGid,
    quantity: normalizedQuantity,
  });
  if (!permalink) {
    return respond(res, 500, {
      ok: false,
      error: 'permalink_build_failed',
    });
  }

  const base = getPublicStorefrontBase();
  const normalizedBase = base ? base.replace(/\/+$/, '') : '';
  const cartPlain = normalizedBase ? `${normalizedBase}/cart` : undefined;
  const checkoutPlain = normalizedBase ? `${normalizedBase}/checkout` : undefined;

  const variantNumericId = idVariantGidToNumeric(variantGid);
  console.info('[cart_add_permalink]', {
    cartId,
    variantId: variantNumericId || null,
    permalink,
  });

  return respond(res, 200, {
    ok: true,
    url: permalink,
    cartUrl: permalink,
    cartWebUrl: permalink,
    cartPlain,
    checkoutPlain,
    usedFallback: false,
  });
}
