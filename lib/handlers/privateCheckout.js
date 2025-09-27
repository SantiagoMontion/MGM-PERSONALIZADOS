import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import {
  resolveVariantIds,
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
    discount: z.any().optional(),
  })
  .passthrough();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

function resolveMode() {
  return 'draft_order';
}

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        lineItems(first: 10) {
          edges {
            node { id }
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const DRAFT_ORDER_INVOICE_SEND_MUTATION = `
  mutation DraftOrderInvoiceSend($id: ID!, $input: DraftOrderInvoiceInput!) {
    draftOrderInvoiceSend(id: $id, input: $input) {
      draftOrder {
        id
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

const DRAFT_ORDER_UPDATE_MUTATION = `
  mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
    draftOrderUpdate(id: $id, input: $input) {
      draftOrder {
        id
        invoiceUrl
        lineItems(first: 10) {
          edges {
            node { id }
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

function readRequestId(resp) {
  if (!resp || typeof resp.headers?.get !== 'function') return '';
  return (
    resp.headers.get('x-request-id') ||
    resp.headers.get('x-requestid') ||
    resp.headers.get('X-Request-ID') ||
    resp.headers.get('X-RequestId') ||
    ''
  );
}

function parseDecimal(value) {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function formatAmount(value) {
  return value.toFixed(2);
}

function normalizeDraftOrderDiscount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scopeRaw = typeof raw.scope === 'string' ? raw.scope.trim().toLowerCase() : '';
  const scope = scopeRaw === 'line' ? 'line' : 'order';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const typeRaw = typeof raw.type === 'string' ? raw.type.trim().toUpperCase() : '';
  let valueType = typeRaw === 'PERCENTAGE' || typeRaw === 'FIXED_AMOUNT' ? typeRaw : '';
  let percentage = parseDecimal(raw.percentage);
  let amount = parseDecimal(raw.amount);
  const valueCandidate = parseDecimal(raw.value);
  if (!valueType) {
    if (percentage != null) {
      valueType = 'PERCENTAGE';
    } else if (amount != null) {
      valueType = 'FIXED_AMOUNT';
    } else if (valueCandidate != null) {
      valueType = valueCandidate > 1 ? 'FIXED_AMOUNT' : 'PERCENTAGE';
    }
  }
  if (valueType === 'PERCENTAGE') {
    if (percentage == null && valueCandidate != null) percentage = valueCandidate;
    if (percentage == null) return null;
    if (percentage <= 0) return null;
    if (percentage > 1000) return null;
    const appliedDiscount = {
      valueType: 'PERCENTAGE',
      value: { percentage: percentage.toFixed(2) },
      ...(title ? { title: title.slice(0, 255) } : {}),
    };
    return {
      scope,
      appliedDiscount,
      lineItemId: typeof raw.lineItemId === 'string' ? raw.lineItemId : undefined,
      lineItemIndex: parseDecimal(raw.lineItemIndex),
    };
  }
  if (valueType === 'FIXED_AMOUNT') {
    if (amount == null && valueCandidate != null) amount = valueCandidate;
    if (amount == null) return null;
    if (amount <= 0) return null;
    const appliedDiscount = {
      valueType: 'FIXED_AMOUNT',
      value: { amount: formatAmount(amount) },
      ...(title ? { title: title.slice(0, 255) } : {}),
    };
    return {
      scope,
      appliedDiscount,
      lineItemId: typeof raw.lineItemId === 'string' ? raw.lineItemId : undefined,
      lineItemIndex: parseDecimal(raw.lineItemIndex),
    };
  }
  return null;
}

async function ensureInvoiceUrl({ draftOrderId, invoiceUrl, email }) {
  const normalized = typeof invoiceUrl === 'string' ? invoiceUrl.trim() : '';
  if (normalized) {
    return { ok: true, invoiceUrl: normalized };
  }
  let resp;
  try {
    resp = await shopifyAdminGraphQL(DRAFT_ORDER_INVOICE_SEND_MUTATION, {
      id: draftOrderId,
      input: email ? { to: email } : {},
    });
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return { ok: false, reason: 'shopify_env_missing', missing: err.missing };
    }
    throw err;
  }
  const requestId = readRequestId(resp);
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    return {
      ok: false,
      reason: 'invoice_http_error',
      status: resp.status,
      body: text?.slice(0, 2000),
      requestId,
    };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'invoice_invalid_response', requestId };
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'invoice_graphql_errors', errors: json.errors, requestId };
  }
  const invoicePayload = json?.data?.draftOrderInvoiceSend;
  if (!invoicePayload || typeof invoicePayload !== 'object') {
    return { ok: false, reason: 'invoice_invalid_response', requestId };
  }
  const invoiceUserErrors = Array.isArray(invoicePayload.userErrors)
    ? invoicePayload.userErrors
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const message = typeof entry.message === 'string' ? entry.message.trim() : '';
          if (!message) return null;
          const code = typeof entry.code === 'string' ? entry.code : undefined;
          const field = Array.isArray(entry.field)
            ? entry.field.map((item) => String(item)).filter(Boolean)
            : undefined;
          return { message, ...(code ? { code } : {}), ...(field && field.length ? { field } : {}) };
        })
        .filter(Boolean)
    : [];
  if (invoiceUserErrors.length) {
    return { ok: false, reason: 'invoice_user_errors', userErrors: invoiceUserErrors, requestId };
  }
  const invoiceDraftOrder = invoicePayload.draftOrder;
  const finalUrl = typeof invoiceDraftOrder?.invoiceUrl === 'string'
    ? invoiceDraftOrder.invoiceUrl.trim()
    : '';
  if (!finalUrl) {
    return { ok: false, reason: 'missing_invoice_url', requestId };
  }
  const lineItems = Array.isArray(invoiceDraftOrder?.lineItems?.edges)
    ? invoiceDraftOrder.lineItems.edges
        .map((edge) => (edge && edge.node && typeof edge.node.id === 'string' ? edge.node.id : null))
        .filter(Boolean)
    : undefined;
  return { ok: true, invoiceUrl: finalUrl, requestId, lineItemIds: lineItems };
}

async function applyDraftOrderDiscount({ draftOrderId, discount, lineItemIds }) {
  if (!discount) {
    return { ok: true, lineItemIds };
  }
  const normalizedLineItems = Array.isArray(lineItemIds) ? lineItemIds.filter(Boolean) : [];
  let targetLineId = typeof discount.lineItemId === 'string' ? discount.lineItemId : '';
  if (discount.scope === 'line') {
    if (!targetLineId && normalizedLineItems.length) {
      if (Number.isFinite(discount.lineItemIndex)) {
        const idx = Math.max(0, Math.floor(discount.lineItemIndex));
        targetLineId = normalizedLineItems[idx] || normalizedLineItems[0];
      } else {
        targetLineId = normalizedLineItems[0];
      }
    }
    if (!targetLineId) {
      return { ok: false, reason: 'missing_line_item' };
    }
  }
  const input = discount.scope === 'line'
    ? { lineItems: [{ id: targetLineId, appliedDiscount: discount.appliedDiscount }] }
    : { appliedDiscount: discount.appliedDiscount };
  let resp;
  try {
    resp = await shopifyAdminGraphQL(DRAFT_ORDER_UPDATE_MUTATION, {
      id: draftOrderId,
      input,
    });
  } catch (err) {
    if (err?.message === 'SHOPIFY_ENV_MISSING') {
      return { ok: false, reason: 'shopify_env_missing', missing: err.missing };
    }
    throw err;
  }
  const requestId = readRequestId(resp);
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    return { ok: false, reason: 'update_http_error', status: resp.status, body: text?.slice(0, 2000), requestId };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'update_invalid_response', requestId };
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'update_graphql_errors', errors: json.errors, requestId };
  }
  const updatePayload = json?.data?.draftOrderUpdate;
  if (!updatePayload || typeof updatePayload !== 'object') {
    return { ok: false, reason: 'update_invalid_response', requestId };
  }
  const userErrors = Array.isArray(updatePayload.userErrors)
    ? updatePayload.userErrors
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const message = typeof entry.message === 'string' ? entry.message.trim() : '';
          if (!message) return null;
          const code = typeof entry.code === 'string' ? entry.code : undefined;
          const field = Array.isArray(entry.field)
            ? entry.field.map((item) => String(item)).filter(Boolean)
            : undefined;
          return { message, ...(code ? { code } : {}), ...(field && field.length ? { field } : {}) };
        })
        .filter(Boolean)
    : [];
  if (userErrors.length) {
    return { ok: false, reason: 'update_user_errors', userErrors, requestId };
  }
  const updatedDraftOrder = updatePayload.draftOrder;
  const invoiceUrl = typeof updatedDraftOrder?.invoiceUrl === 'string'
    ? updatedDraftOrder.invoiceUrl.trim()
    : '';
  const updatedLineItems = Array.isArray(updatedDraftOrder?.lineItems?.edges)
    ? updatedDraftOrder.lineItems.edges
        .map((edge) => (edge && edge.node && typeof edge.node.id === 'string' ? edge.node.id : null))
        .filter(Boolean)
    : normalizedLineItems;
  return { ok: true, invoiceUrl, requestId, lineItemIds: updatedLineItems };
}

async function createDraftOrder({ variantGid, quantity, note, attributes, email, discount }) {
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
    tags: ['private', 'custom-mockup'],
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
    const normalized = attributes.map((attr) => ({ key: attr.key, value: attr.value }));
    input.customAttributes = normalized;
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
  const requestId = readRequestId(resp);
  const requestIds = requestId ? [requestId] : [];
  const textBody = await resp.text();
  let json;
  try {
    json = textBody ? JSON.parse(textBody) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    return {
      ok: false,
      reason: 'http_error',
      status: resp.status,
      body: textBody?.slice(0, 2000),
      requestId,
    };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId };
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'graphql_errors', errors: json.errors, requestId };
  }
  const payload = json?.data?.draftOrderCreate;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId };
  }
  const userErrors = Array.isArray(payload.userErrors)
    ? payload.userErrors
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const message = typeof entry.message === 'string' ? entry.message.trim() : '';
          if (!message) return null;
          const code = typeof entry.code === 'string' ? entry.code : undefined;
          const field = Array.isArray(entry.field)
            ? entry.field.map((item) => String(item)).filter(Boolean)
            : undefined;
          return { message, ...(code ? { code } : {}), ...(field && field.length ? { field } : {}) };
        })
        .filter(Boolean)
    : [];
  if (userErrors.length) {
    return { ok: false, reason: 'user_errors', userErrors, requestId };
  }
  const draftOrder = payload.draftOrder;
  if (!draftOrder || typeof draftOrder !== 'object') {
    return { ok: false, reason: 'missing_draft_order', requestId };
  }
  const draftOrderId = typeof draftOrder.id === 'string' ? draftOrder.id : '';
  if (!draftOrderId) {
    return { ok: false, reason: 'missing_draft_order', requestId };
  }
  const draftOrderName = typeof draftOrder.name === 'string' ? draftOrder.name : null;
  let invoiceUrl = typeof draftOrder.invoiceUrl === 'string' ? draftOrder.invoiceUrl.trim() : '';
  let lineItemIds = Array.isArray(draftOrder.lineItems?.edges)
    ? draftOrder.lineItems.edges
        .map((edge) => (edge && edge.node && typeof edge.node.id === 'string' ? edge.node.id : null))
        .filter(Boolean)
    : [];
  const normalizedDiscount = normalizeDraftOrderDiscount(discount);
  if (normalizedDiscount) {
    const discountResult = await applyDraftOrderDiscount({
      draftOrderId,
      discount: normalizedDiscount,
      lineItemIds,
    });
    if (!discountResult.ok) {
      return {
        ok: false,
        reason: discountResult.reason || 'discount_failed',
        userErrors: discountResult.userErrors,
        status: discountResult.status,
        body: discountResult.body,
        requestId: discountResult.requestId,
        missing: discountResult.missing,
      };
    }
    if (discountResult.requestId) requestIds.push(discountResult.requestId);
    if (Array.isArray(discountResult.lineItemIds)) {
      lineItemIds = discountResult.lineItemIds;
    }
    if (typeof discountResult.invoiceUrl === 'string' && discountResult.invoiceUrl.trim()) {
      invoiceUrl = discountResult.invoiceUrl.trim();
    }
  }
  const invoiceResult = await ensureInvoiceUrl({
    draftOrderId,
    invoiceUrl,
    email,
  });
  if (!invoiceResult.ok) {
    const combinedIds = invoiceResult.requestId ? requestIds.concat(invoiceResult.requestId) : requestIds;
    return {
      ok: false,
      reason: invoiceResult.reason || 'invoice_failed',
      userErrors: invoiceResult.userErrors,
      status: invoiceResult.status,
      body: invoiceResult.body,
      requestId: invoiceResult.requestId,
      missing: invoiceResult.missing,
      requestIds: combinedIds,
    };
  }
  if (invoiceResult.requestId) requestIds.push(invoiceResult.requestId);
  const finalInvoiceUrl = invoiceResult.invoiceUrl;
  if (!finalInvoiceUrl) {
    return { ok: false, reason: 'missing_invoice_url', requestIds };
  }
  return {
    ok: true,
    checkoutUrl: finalInvoiceUrl,
    draftOrderId: draftOrderId || null,
    draftOrderName: draftOrderName || null,
    requestIds,
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
    const { variantId, variantGid, quantity, email, note, attributes, noteAttributes, discount } = parsed.data;
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

    async function handleDraftOrder(trigger = null) {
      let draftAttempt;
      try {
        draftAttempt = await createDraftOrder({
          variantGid: resolvedVariantGid,
          quantity: qty,
          note,
          attributes: normalizedAttributes,
          email,
          discount,
        });
      } catch (err) {
        console.error?.('[private-checkout] draft_order_error', err);
        res.status(502).json({ reason: 'shopify_unreachable' });
        return true;
      }
      if (!draftAttempt.ok) {
        logResult('warn', {
          mode,
          variantGid: resolvedVariantGid,
          variantNumericId,
          strategy: 'draft_order',
          fallbackFrom: trigger,
          reason: draftAttempt.reason,
          userErrors: draftAttempt.userErrors || null,
          requestId: draftAttempt.requestId || null,
          requestIds: draftAttempt.requestIds || null,
        });
        if (draftAttempt.reason === 'shopify_env_missing') {
          res.status(500).json({ reason: 'shopify_env_missing', missing: draftAttempt.missing });
          return true;
        }
        if (draftAttempt.reason === 'user_errors') {
          res.status(502).json({
            reason: 'shopify_user_errors',
            userErrors: draftAttempt.userErrors,
            ...(draftAttempt.requestId ? { requestId: draftAttempt.requestId } : {}),
            ...(Array.isArray(draftAttempt.requestIds) ? { requestIds: draftAttempt.requestIds } : {}),
          });
          return true;
        }
        res.status(502).json({
          reason: draftAttempt.reason || 'draft_order_failed',
          ...(draftAttempt.status ? { status: draftAttempt.status } : {}),
          ...(draftAttempt.body ? { detail: draftAttempt.body } : {}),
          ...(draftAttempt.requestId ? { requestId: draftAttempt.requestId } : {}),
          ...(Array.isArray(draftAttempt.requestIds) ? { requestIds: draftAttempt.requestIds } : {}),
          ...(Array.isArray(draftAttempt.missing) ? { missing: draftAttempt.missing } : {}),
        });
        return true;
      }
      logResult('info', {
        mode,
        variantGid: resolvedVariantGid,
        variantNumericId,
        strategy: 'draft_order',
        fallbackFrom: trigger,
        requestIds: draftAttempt.requestIds || null,
      });
      res.status(200).json({
        checkoutUrl: draftAttempt.checkoutUrl,
        draftOrderId: draftAttempt.draftOrderId || undefined,
        draftOrderName: draftAttempt.draftOrderName || undefined,
        draft_order_id: draftAttempt.draftOrderId || undefined,
        draft_order_name: draftAttempt.draftOrderName || undefined,
        strategy: 'draft_order',
        ...(Array.isArray(draftAttempt.requestIds) ? { requestIds: draftAttempt.requestIds } : {}),
        ...(trigger ? { fallbackFrom: trigger } : {}),
      });
      return true;
    }

    await handleDraftOrder();
    return;
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
