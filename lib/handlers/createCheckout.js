import { z } from 'zod';
import { getPublicStorefrontBase } from '../publicStorefront.js';
import { getShopifySalesChannel, shopifyAdmin } from '../shopify.js';
import { parseJsonBody } from '../_lib/http.js';

function normalizeVariantId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

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
  })
  .passthrough();

function parseVariantNumericId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

async function createDraftOrderCheckout({ variantId, quantity, email, note, noteAttributes }) {
  const numericVariantId = parseVariantNumericId(variantId);
  if (!numericVariantId) {
    return { ok: false, reason: 'invalid_variant' };
  }

  const payload = {
    draft_order: {
      line_items: [
        {
          variant_id: numericVariantId,
          quantity,
        },
      ],
      use_customer_default_address: true,
      tags: 'private, editor',
    },
  };

  if (email) {
    payload.draft_order.email = email;
  }

  if (typeof note === 'string') {
    const trimmedNote = note.trim();
    if (trimmedNote) {
      payload.draft_order.note = trimmedNote.slice(0, 1024);
    }
  }

  const attributesList = Array.isArray(noteAttributes) ? noteAttributes : [];
  const baseAttributes = [{ name: 'mgm_source', value: 'editor' }, ...attributesList];
  const normalizedAttributes = [];
  const seenNames = new Set();
  for (const attr of baseAttributes) {
    if (!attr || typeof attr.name !== 'string' || typeof attr.value !== 'string') continue;
    const name = attr.name.trim();
    const value = attr.value.trim();
    if (!name || !value) continue;
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    normalizedAttributes.push({ name, value: value.slice(0, 255) });
  }
  if (normalizedAttributes.length) {
    payload.draft_order.note_attributes = normalizedAttributes;
  }

  const resp = await shopifyAdmin('draft_orders.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    return {
      ok: false,
      reason: 'draft_order_http_error',
      status: resp.status,
      detail: typeof json === 'object' ? json : undefined,
    };
  }

  const invoiceUrl = json?.draft_order?.invoice_url;
  if (!invoiceUrl) {
    return { ok: false, reason: 'missing_invoice_url', detail: json };
  }

  return {
    ok: true,
    url: invoiceUrl,
    draftOrderId: json?.draft_order?.id,
    draftOrderName: json?.draft_order?.name,
  };
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
    const { variantId, variantGid, quantity, email, mode, note, noteAttributes } = parsed.data;
    const normalizedVariantId = normalizeVariantId(variantId ?? variantGid);
    if (!normalizedVariantId) return res.status(400).json({ ok: false, error: 'missing_variant' });
    const qtyRaw = Number(quantity);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(Math.floor(qtyRaw), 99) : 1;
    const base = getPublicStorefrontBase();
    if (!base) return res.status(500).json({ ok: false, error: 'missing_store_domain' });

    const normalizedEmail = typeof email === 'string' ? email.trim() : '';

    if (mode === 'private') {
      if (!normalizedEmail) {
        return res.status(400).json({ ok: false, error: 'missing_email' });
      }
      try {
        const draftCheckout = await createDraftOrderCheckout({
          variantId: normalizedVariantId,
          quantity: qty,
          email: normalizedEmail,
          note,
          noteAttributes,
        });
        if (!draftCheckout?.ok || !draftCheckout?.url) {
          return res.status(502).json({
            ok: false,
            error: draftCheckout?.reason || 'draft_order_failed',
            detail: draftCheckout?.detail,
            status: draftCheckout?.status,
          });
        }
        return res.status(200).json({
          ok: true,
          url: draftCheckout.url,
          draft_order_id: draftCheckout.draftOrderId,
          draft_order_name: draftCheckout.draftOrderName,
        });
      } catch (err) {
        if (err?.message === 'SHOPIFY_ENV_MISSING') {
          return res.status(400).json({ ok: false, error: 'shopify_env_missing', missing: err?.missing });
        }
        console.error('create_checkout_draft_order_error', err);
        return res.status(500).json({ ok: false, error: 'draft_order_failed' });
      }
    }

    let checkoutUrl;
    try {
      checkoutUrl = new URL(`/cart/${normalizedVariantId}:${qty}`, base);
    } catch (err) {
      console.error('create_checkout_url_error', err);
      return res.status(500).json({ ok: false, error: 'invalid_store_domain' });
    }

    const checkoutChannel = getShopifySalesChannel('checkout');
    if (checkoutChannel) checkoutUrl.searchParams.set('channel', checkoutChannel);
    if (normalizedEmail) {
      checkoutUrl.searchParams.set('checkout[email]', normalizedEmail);
    }
    const checkoutReturnToRaw = typeof process.env.SHOPIFY_CHECKOUT_RETURN_TO === 'string'
      ? process.env.SHOPIFY_CHECKOUT_RETURN_TO.trim()
      : '';
    checkoutUrl.searchParams.set('return_to', checkoutReturnToRaw || '/checkout');

    return res.status(200).json({ ok: true, url: checkoutUrl.toString() });
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

