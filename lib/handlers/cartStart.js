import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';

const BodySchema = z
  .object({
    variantGid: z.string(),
    quantity: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.floor(raw));
}

const CART_ORIGIN = (process.env.SHOPIFY_CART_ORIGIN || 'https://www.mgmgamers.store').replace(/\/+$/, '');

function buildCartPermalink(variantNumericId, quantity) {
  const id = variantNumericId ? String(variantNumericId).trim() : '';
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.max(1, Math.floor(quantity)) : 1;
  if (!id) return '';
  const params = new URLSearchParams({ id, quantity: String(qty), return_to: '/cart' });
  return `${CART_ORIGIN}/cart/add?${params.toString()}`;
}

function respond(res, status, payload, logLabel = 'cart_start_response') {
  const body = payload ?? {};
  const contentType = 'application/json; charset=utf-8';
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', contentType);
  }
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  if (typeof res.json === 'function') {
    res.json(body);
  } else if (typeof res.send === 'function') {
    res.send(JSON.stringify(body));
  } else {
    res.end(JSON.stringify(body));
  }
  try {
    console.info(logLabel, { status, contentType, body });
  } catch {}
}

export default async function cartStart(req, res) {
  try {
    console.info('cart_start_request', { method: req.method, path: req.url || '' });
  } catch {}

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

  const { variantGid, quantity } = parsed.data;
  if (!variantGid.startsWith('gid://shopify/ProductVariant/')) {
    return respond(res, 400, { ok: false, error: 'invalid_variant_gid' });
  }

  const normalizedQuantity = normalizeQuantity(quantity ?? 1);
  const buyerIp = getClientIp(req);
  const variantNumericId = variantGid.split('/').pop();
  const permalink = buildCartPermalink(variantNumericId, normalizedQuantity);

  if (!permalink) {
    try {
      console.warn('cart_start_permalink_missing', { variantGid, variantNumericId });
    } catch {}
    return respond(res, 500, { ok: false, error: 'permalink_unavailable' });
  }

  try {
    console.info('cart_start_url_returned', {
      url: permalink,
      variantGid,
      variantNumericId,
      buyerIp: buyerIp || null,
      return_to: '/cart',
    });
  } catch {}

  return respond(res, 200, { ok: true, url: permalink }, 'cart_start_success');
}
