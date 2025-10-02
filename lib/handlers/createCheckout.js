import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import { buildOnlineStoreCartPermalink } from '../utils/permalink.js';
import { idVariantGidToNumeric } from '../utils/shopifyIds.js';

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    email: z.string().email().optional(),
    mode: z.enum(['checkout', 'cart', 'private']).optional(),
    note: z.string().optional(),
    noteAttributes: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
        }),
      )
      .optional(),
    discount: z.string().optional(),
  })
  .passthrough();

function parseVariantNumericId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

export default async function createCheckout(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const body = await parseJsonBody(req).catch((err) => {
      if (err?.code === 'payload_too_large') {
        if (typeof res.status === 'function') res.status(413);
        else res.statusCode = 413;
        throw new Error('payload_too_large');
      }
      if (err?.code === 'invalid_json') {
        if (typeof res.status === 'function') res.status(400);
        else res.statusCode = 400;
        throw new Error('invalid_json');
      }
      throw err;
    });
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'invalid_body', issues: parsed.error.flatten().fieldErrors });
    }
    const { variantId, variantGid, quantity, discount } = parsed.data;
    let normalizedVariantId;
    try {
      normalizedVariantId = idVariantGidToNumeric(variantGid ?? variantId ?? '');
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_variant_id',
        code: 'INVALID_VARIANT_ID',
        message: err?.message || 'Invalid variant ID format',
      });
    }
    if (!normalizedVariantId) {
      return res.status(400).json({ ok: false, error: 'missing_variant' });
    }
    if (!/^\d+$/.test(String(normalizedVariantId || ''))) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_variant_id',
        code: 'INVALID_VARIANT_ID',
        message: 'Invalid variant ID format',
      });
    }
    const qtyRaw = Number(quantity);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(Math.floor(qtyRaw), 99) : 1;

    const normalizedDiscount = typeof discount === 'string' ? discount.trim() : '';
    const permalink = buildOnlineStoreCartPermalink(normalizedVariantId, qty, normalizedDiscount);
    if (!permalink) {
      return res.status(500).json({ ok: false, error: 'permalink_build_failed' });
    }

    try {
      console.info('permalink_build', {
        variantGid: typeof variantGid === 'string' ? variantGid : variantId ?? null,
        numericId: normalizedVariantId,
        qty,
      });
    } catch {}

    return res.status(200).json({ ok: true, url: permalink });
  } catch (e) {
    if (res.statusCode === 413) {
      return res.json({ ok: false, error: 'payload_too_large' });
    }
    if (res.statusCode === 400 && String(e?.message).includes('invalid_json')) {
      return res.json({ ok: false, error: 'invalid_json' });
    }
    console.error('create_checkout_error', e);
    return res.status(500).json({ ok: false, error: 'create_checkout_failed' });
  }
}

