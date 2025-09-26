import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import {
  resolveVariantIds,
  precheckVariantAvailability,
  createStorefrontCart,
  normalizeCartAttributes,
  normalizeCartNote,
} from '../shopify/cartHelpers.js';
import { shopifyAdminGraphQL } from '../shopify.js';

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    email: z.string().email().optional(),
    note: z.any().optional(),
    attributes: z.any().optional(),
    noteAttributes: z.any().optional(),
  })
  .passthrough();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

function resolveMode() {
  const envRaw = typeof process.env.PRIVATE_CHECKOUT_MODE === 'string'
    ? process.env.PRIVATE_CHECKOUT_MODE.trim().toLowerCase()
    : '';
  if (envRaw === 'draft_order') return 'draft_order';
  return 'storefront';
}

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

async function createDraftOrder({ variantGid, quantity, note, attributes, email }) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid' };
  }
  const qty = normalizeQuantity(quantity);
  const input = {
    lineItems: [
      {
        variantId: variantGid,
        quantity: qty,
      },
    ],
    tags: ['private'],
    allowPartialPayments: false,
  };
  const noteValue = normalizeCartNote(note);
  if (noteValue) {
    input.note = noteValue;
  }
  if (email) {
    input.email = email;
  }
  if (Array.isArray(attributes) && attributes.length) {
    input.customAttributes = attributes.map((attr) => ({ key: attr.key, value: attr.value }));
  }
  let resp;
  try {
    resp = await shopifyAdminGraphQL(DRAFT_ORDER_CREATE_MUTATION, { input });
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return { ok: false, reason: 'shopify_env_missing', missing: err.missing };
    }
    throw err;
  }
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    return { ok: false, reason: 'http_error', status: resp.status, body: text?.slice(0, 2000) };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'invalid_response' };
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'graphql_errors', errors: json.errors };
  }
  const payload = json?.data?.draftOrderCreate;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_response' };
  }
  const userErrors = Array.isArray(payload.userErrors)
    ? payload.userErrors
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const message = typeof entry.message === 'string' ? entry.message.trim() : '';
          if (!message) return null;
          const code = typeof entry.code === 'string' ? entry.code : undefined;
          const field = Array.isArray(entry.field) ? entry.field.map((item) => String(item)).filter(Boolean) : undefined;
          return { message, ...(code ? { code } : {}), ...(field && field.length ? { field } : {}) };
        })
        .filter(Boolean)
    : [];
  if (userErrors.length) {
    return { ok: false, reason: 'user_errors', userErrors };
  }
  const draftOrder = payload.draftOrder;
  if (!draftOrder || typeof draftOrder !== 'object') {
    return { ok: false, reason: 'missing_draft_order' };
  }
  const invoiceUrl = typeof draftOrder.invoiceUrl === 'string' ? draftOrder.invoiceUrl.trim() : '';
  if (!invoiceUrl) {
    return { ok: false, reason: 'missing_invoice_url' };
  }
  return {
    ok: true,
    checkoutUrl: invoiceUrl,
    draftOrderId: draftOrder.id || null,
    draftOrderName: draftOrder.name || null,
  };
}

function logResult(level, payload) {
  try {
    const logger = level === 'warn' ? console.warn : console.info;
    logger('[private-checkout] result', payload);
  } catch {}
}

export default async function privateCheckout(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ reason: 'method_not_allowed' });
  }
  try {
    const body = await parseJsonBody(req).catch((err) => {
      if (err?.code === 'payload_too_large') {
        res.statusCode = 413;
        throw err;
      }
      if (err?.code === 'invalid_json') {
        res.statusCode = 400;
        throw err;
      }
      throw err;
    });
    const parsed = BodySchema.safeParse(body || {});
    if (!parsed.success) {
      return res.status(400).json({ reason: 'bad_request' });
    }
    const { variantId, variantGid, quantity, email, note, attributes, noteAttributes } = parsed.data;
    let { variantNumericId, variantGid: resolvedVariantGid } = resolveVariantIds({ variantId, variantGid });
    if (!variantNumericId) {
      return res.status(400).json({ reason: 'bad_request' });
    }
    if (!resolvedVariantGid || !resolvedVariantGid.startsWith('gid://shopify/ProductVariant/')) {
      resolvedVariantGid = `gid://shopify/ProductVariant/${variantNumericId}`;
    }
    const qty = normalizeQuantity(quantity);
    const mode = resolveMode();

    const attributesInput = noteAttributes ?? attributes;
    const normalizedAttributes = normalizeCartAttributes(attributesInput);

    if (mode === 'draft_order') {
      let draftAttempt;
      try {
        draftAttempt = await createDraftOrder({
          variantGid: resolvedVariantGid,
          quantity: qty,
          note,
          attributes: normalizedAttributes,
          email,
        });
      } catch (err) {
        console.error?.('[private-checkout] draft_order_error', err);
        return res.status(502).json({ reason: 'shopify_unreachable' });
      }
      if (!draftAttempt.ok) {
        logResult('warn', {
          mode,
          variantGid: resolvedVariantGid,
          variantNumericId,
          reason: draftAttempt.reason,
          userErrors: draftAttempt.userErrors || null,
        });
        if (draftAttempt.reason === 'shopify_env_missing') {
          return res.status(500).json({ reason: 'shopify_env_missing', missing: draftAttempt.missing });
        }
        if (draftAttempt.reason === 'user_errors') {
          return res.status(502).json({ reason: 'shopify_user_errors', userErrors: draftAttempt.userErrors });
        }
        return res.status(502).json({ reason: draftAttempt.reason || 'draft_order_failed' });
      }
      logResult('info', {
        mode,
        variantGid: resolvedVariantGid,
        variantNumericId,
        strategy: 'draft_order',
      });
      return res.status(200).json({
        checkoutUrl: draftAttempt.checkoutUrl,
        draftOrderId: draftAttempt.draftOrderId || undefined,
        draftOrderName: draftAttempt.draftOrderName || undefined,
        draft_order_id: draftAttempt.draftOrderId || undefined,
        draft_order_name: draftAttempt.draftOrderName || undefined,
        strategy: 'draft_order',
      });
    }

    const buyerIp = getClientIp(req);
    const precheck = await precheckVariantAvailability(resolvedVariantGid, { maxAttempts: 3 });
    if (!precheck.ok || precheck.available === false) {
      logResult('warn', {
        mode,
        variantGid: resolvedVariantGid,
        variantNumericId,
        reason: precheck.reason || 'precheck_failed',
      });
      return res.status(502).json({ reason: 'variant_unavailable' });
    }

    let storefrontAttempt;
    try {
      storefrontAttempt = await createStorefrontCart({
        variantGid: resolvedVariantGid,
        quantity: qty,
        buyerIp,
        attributes: normalizedAttributes,
        note,
      });
    } catch (err) {
      console.error?.('[private-checkout] storefront_error', err);
      return res.status(502).json({ reason: 'shopify_unreachable' });
    }
    if (!storefrontAttempt.ok) {
      logResult('warn', {
        mode,
        variantGid: resolvedVariantGid,
        variantNumericId,
        reason: storefrontAttempt.reason,
        userErrors: storefrontAttempt.userErrors || null,
      });
      if (storefrontAttempt.reason === 'storefront_env_missing') {
        return res.status(500).json({ reason: 'shopify_env_missing', missing: storefrontAttempt.missing });
      }
      if (storefrontAttempt.reason === 'user_errors') {
        return res.status(502).json({ reason: 'shopify_user_errors', userErrors: storefrontAttempt.userErrors });
      }
      return res.status(502).json({ reason: storefrontAttempt.reason || 'checkout_failed' });
    }

    let checkoutUrl = storefrontAttempt.checkoutUrl || '';
    if (checkoutUrl && email) {
      try {
        const checkoutObj = new URL(checkoutUrl);
        checkoutObj.searchParams.set('checkout[email]', email);
        checkoutUrl = checkoutObj.toString();
      } catch {}
    }

    logResult('info', {
      mode,
      variantGid: resolvedVariantGid,
      variantNumericId,
      strategy: 'storefront',
      requestId: storefrontAttempt.requestId || precheck.requestId || null,
    });

    return res.status(200).json({
      checkoutUrl: checkoutUrl || null,
      cartUrl: storefrontAttempt.cartUrl || null,
      cartPlain: storefrontAttempt.cartPlain || null,
      strategy: 'storefront',
    });
  } catch (err) {
    if (res.statusCode === 413) {
      return res.json({ reason: 'payload_too_large' });
    }
    if (res.statusCode === 400 && err?.code === 'invalid_json') {
      return res.json({ reason: 'bad_request' });
    }
    console.error?.('[private-checkout] unhandled_error', err);
    return res.status(500).json({ reason: 'internal_error' });
  }
}
