import { z } from 'zod';
import { parseJsonBody } from '../_lib/http.js';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import {
  resolveVariantIds,
  buildCartPermalink,
  precheckVariantAvailability,
} from '../shopify/cartHelpers.js';

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    jobId: z.union([z.string(), z.number()]).optional(),
    job_id: z.union([z.string(), z.number()]).optional(),
    attributes: z.any().optional(),
    note: z.any().optional(),
  })
  .passthrough();

function normalizeQuantity(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

function normalizeJobId(valueA, valueB) {
  const candidates = [valueA, valueB];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const raw = String(candidate).trim();
    if (!raw) continue;
    if (/^[A-Za-z0-9_-]{8,64}$/.test(raw)) return raw;
  }
  return '';
}

async function resolveVariantFromJob(jobId) {
  if (!jobId) {
    return { ok: false, reason: 'missing_job_id' };
  }
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return { ok: false, reason: 'supabase_env_missing', error: err };
  }
  const { data, error } = await supabase
    .from('jobs')
    .select('shopify_variant_id')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) {
    return { ok: false, reason: 'supabase_error', detail: error.message };
  }
  if (!data) {
    return { ok: false, reason: 'job_not_found' };
  }
  const resolved = resolveVariantIds({ variantId: data.shopify_variant_id });
  if (!resolved.variantNumericId) {
    return { ok: false, reason: 'variant_missing' };
  }
  return { ok: true, ...resolved };
}

function logEvent(event, payload, level = 'info') {
  try {
    const logger = level === 'warn' ? console.warn : console.info;
    logger(`[cart-link] ${event}`, payload);
  } catch {}
}

function respondError(res, status, reason, extra = {}) {
  const payload = { ok: false, error: reason, reason, ...extra };
  return res.status(status).json(payload);
}

function respondSuccess(res, payload) {
  return res.status(200).json({ ok: true, ...payload });
}

function buildFallbackResponse({ variantNumericId, quantity, requestId, reason, userErrors }) {
  const fallbackUrl = buildCartPermalink(variantNumericId, quantity);
  if (!fallbackUrl) return null;
  return {
    url: fallbackUrl,
    webUrl: fallbackUrl,
    checkoutUrl: null,
    cartPlain: 'https://www.mgmgamers.store/cart',
    checkoutPlain: 'https://www.mgmgamers.store/checkout',
    cart_id: null,
    cart_token: null,
    strategy: 'permalink',
    requestId: requestId || undefined,
    fallbackReason: reason || undefined,
    reason: reason || undefined,
    ...(Array.isArray(userErrors) && userErrors.length ? { userErrors } : {}),
  };
}

function buildPermalinkSuccess({ variantNumericId, variantGid, quantity, requestId }) {
  const permalink = buildCartPermalink(variantNumericId, quantity);
  if (!permalink) return null;
  try {
    console.info('permalink_build', {
      variantGid: variantGid || null,
      numericId: variantNumericId || null,
      qty: quantity,
    });
  } catch {}
  return {
    url: permalink,
    webUrl: permalink,
    checkoutUrl: permalink,
    cartPlain: 'https://www.mgmgamers.store/cart',
    checkoutPlain: 'https://www.mgmgamers.store/checkout',
    cart_id: null,
    cart_token: null,
    strategy: 'permalink',
    requestId: requestId || undefined,
  };
}

export default async function cartLink(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respondError(res, 405, 'method_not_allowed');

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

      return respondError(res, 400, 'bad_request');

    }
    const { variantId, variantGid, quantity, jobId: jobIdRaw, job_id } = parsed.data;
    const jobId = normalizeJobId(jobIdRaw, job_id);

    let { variantNumericId, variantGid: resolvedVariantGid } = resolveVariantIds({ variantId, variantGid });

    if (!variantNumericId && jobId) {
      const fromJob = await resolveVariantFromJob(jobId);
      if (!fromJob.ok) {
        if (fromJob.reason === 'supabase_env_missing') {

          return respondError(res, 500, 'supabase_env_missing');
        }
        if (fromJob.reason === 'supabase_error') {
          return respondError(res, 502, 'supabase_error', { detail: fromJob.detail });
        }
        if (fromJob.reason === 'job_not_found') {
          return respondError(res, 404, 'job_not_found');
        }
        if (fromJob.reason === 'variant_missing') {
          return respondError(res, 409, 'job_variant_missing');
        }
        return respondError(res, 400, 'bad_request');

      }
      variantNumericId = fromJob.variantNumericId;
      resolvedVariantGid = fromJob.variantGid;
    }

    if (!variantNumericId) {

      if (jobId) {
        return respondError(res, 409, 'job_variant_missing');
      }
      return respondError(res, 400, 'missing_variant');

    }
    if (!resolvedVariantGid || !resolvedVariantGid.startsWith('gid://shopify/ProductVariant/')) {
      resolvedVariantGid = `gid://shopify/ProductVariant/${variantNumericId}`;
    }

    const qty = normalizeQuantity(quantity);

    const poll = await precheckVariantAvailability(resolvedVariantGid, {
      maxAttempts: 10,
      initialDelayMs: 1500,
    });
    if (!poll.ok || poll.available === false) {
      const fallback = buildFallbackResponse({
        variantNumericId,
        quantity: qty,
        requestId: poll.requestId || null,
        reason: poll.reason || 'variant_unavailable',
      });
      if (!fallback) {
        return respondError(res, 400, 'missing_variant');
      }
      logEvent(
        'fallback_permalink',
        {
          variantGid: resolvedVariantGid,
          variantNumericId,
          requestId: poll.requestId || null,
          reason: poll.reason || 'variant_unavailable',
          attempts: poll.attempts || null,
        },
        poll.reason === 'storefront_env_missing' ? 'warn' : 'info',
      );
      return respondSuccess(res, fallback);
    }

    const successPayload = buildPermalinkSuccess({
      variantNumericId,
      variantGid: resolvedVariantGid,
      quantity: qty,
      requestId: poll.requestId || null,
    });
    if (!successPayload) {
      return respondError(res, 500, 'permalink_build_failed');
    }
    logEvent('cart_permalink', {
      variantGid: resolvedVariantGid,
      variantNumericId,
      requestId: poll.requestId || null,
      strategy: 'permalink',
    });
    return respondSuccess(res, successPayload);

  } catch (err) {
    if (res.statusCode === 413) {

      return res.json({ error: 'payload_too_large', reason: 'payload_too_large' });
    }
    if (res.statusCode === 400 && err?.code === 'invalid_json') {
      return res.json({ error: 'bad_request', reason: 'bad_request' });
    }
    console.error?.('[cart-link] unhandled_error', err);
    return respondError(res, 500, 'internal_error');

  }
}
