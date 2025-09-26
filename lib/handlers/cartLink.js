import { z } from 'zod';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import {
  resolveVariantIds,
  buildCartPermalink,
  precheckVariantAvailability,
  createStorefrontCart,
  normalizeCartAttributes,
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

function logResult(level, payload) {
  try {
    const logger = level === 'warn' ? console.warn : console.info;
    logger('[cart-link] result', payload);
  } catch {}
}

export default async function cartLink(req, res) {
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
    const { variantId, variantGid, quantity, jobId: jobIdRaw, job_id, attributes, note } = parsed.data;
    const jobId = normalizeJobId(jobIdRaw, job_id);

    let { variantNumericId, variantGid: resolvedVariantGid } = resolveVariantIds({ variantId, variantGid });

    if (!variantNumericId && jobId) {
      const fromJob = await resolveVariantFromJob(jobId);
      if (!fromJob.ok) {
        if (fromJob.reason === 'supabase_env_missing') {
          return res.status(500).json({ reason: 'supabase_env_missing' });
        }
        if (fromJob.reason === 'supabase_error') {
          return res.status(502).json({ reason: 'supabase_error', detail: fromJob.detail });
        }
        if (fromJob.reason === 'job_not_found') {
          return res.status(404).json({ reason: 'job_not_found' });
        }
        return res.status(400).json({ reason: 'bad_request' });
      }
      variantNumericId = fromJob.variantNumericId;
      resolvedVariantGid = fromJob.variantGid;
    }

    if (!variantNumericId) {
      return res.status(400).json({ reason: 'bad_request' });
    }
    if (!resolvedVariantGid || !resolvedVariantGid.startsWith('gid://shopify/ProductVariant/')) {
      resolvedVariantGid = `gid://shopify/ProductVariant/${variantNumericId}`;
    }

    const qty = normalizeQuantity(quantity);
    const buyerIp = getClientIp(req);

    let precheck = await precheckVariantAvailability(resolvedVariantGid, { maxAttempts: 3 });
    if (!precheck.ok || precheck.available === false) {
      const fallbackUrl = buildCartPermalink(variantNumericId, qty);
      logResult('warn', {
        variantGid: resolvedVariantGid,
        variantNumericId,
        requestId: precheck.requestId || null,
        reason: precheck.reason || 'precheck_failed',
        strategy: 'permalink',
      });
      if (!fallbackUrl) {
        return res.status(400).json({ reason: 'bad_request' });
      }
      return res.status(200).json({
        webUrl: fallbackUrl,
        checkoutUrl: null,
        cartPlain: 'https://www.mgmgamers.store/cart',
        checkoutPlain: 'https://www.mgmgamers.store/checkout',
        strategy: 'permalink',
      });
    }

    const normalizedAttributes = normalizeCartAttributes(attributes);

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
      logResult('warn', {
        variantGid: resolvedVariantGid,
        variantNumericId,
        requestId: null,
        reason: err?.message || 'storefront_error',
        strategy: 'permalink',
      });
      const fallbackUrl = buildCartPermalink(variantNumericId, qty);
      if (!fallbackUrl) {
        return res.status(502).json({ reason: 'shopify_unreachable' });
      }
      return res.status(200).json({
        webUrl: fallbackUrl,
        checkoutUrl: null,
        cartPlain: 'https://www.mgmgamers.store/cart',
        checkoutPlain: 'https://www.mgmgamers.store/checkout',
        strategy: 'permalink',
      });
    }

    if (!storefrontAttempt.ok && storefrontAttempt.reason === 'user_errors') {
      precheck = await precheckVariantAvailability(resolvedVariantGid, { maxAttempts: 3 });
      if (precheck.ok && precheck.available !== false) {
        const retry = await createStorefrontCart({
          variantGid: resolvedVariantGid,
          quantity: qty,
          buyerIp,
          attributes: normalizedAttributes,
          note,
        });
        if (retry.ok) {
          logResult('info', {
            variantGid: resolvedVariantGid,
            variantNumericId,
            requestId: retry.requestId || storefrontAttempt.requestId || null,
            userErrors: null,
            strategy: 'storefront',
          });
          return res.status(200).json({
            webUrl: retry.cartUrl,
            checkoutUrl: retry.checkoutUrl || null,
            cartPlain: retry.cartPlain || null,
            checkoutPlain: retry.checkoutPlain || null,
            strategy: 'storefront',
          });
        }
        storefrontAttempt = retry;
      }
    }

    if (storefrontAttempt.ok) {
      logResult('info', {
        variantGid: resolvedVariantGid,
        variantNumericId,
        requestId: storefrontAttempt.requestId || precheck.requestId || null,
        userErrors: null,
        strategy: 'storefront',
      });
      return res.status(200).json({
        webUrl: storefrontAttempt.cartUrl,
        checkoutUrl: storefrontAttempt.checkoutUrl || null,
        cartPlain: storefrontAttempt.cartPlain || null,
        checkoutPlain: storefrontAttempt.checkoutPlain || null,
        strategy: 'storefront',
      });
    }

    const fallbackUrl = buildCartPermalink(variantNumericId, qty);
    if (!fallbackUrl) {
      return res.status(400).json({ reason: 'bad_request' });
    }
    logResult('warn', {
      variantGid: resolvedVariantGid,
      variantNumericId,
      requestId: storefrontAttempt.requestId || precheck.requestId || null,
      userErrors: storefrontAttempt.userErrors || null,
      reason: storefrontAttempt.reason || 'storefront_failed',
      strategy: 'permalink',
    });
    return res.status(200).json({
      webUrl: fallbackUrl,
      checkoutUrl: null,
      cartPlain: 'https://www.mgmgamers.store/cart',
      checkoutPlain: 'https://www.mgmgamers.store/checkout',
      strategy: 'permalink',
    });
  } catch (err) {
    if (res.statusCode === 413) {
      return res.json({ reason: 'payload_too_large' });
    }
    if (res.statusCode === 400 && err?.code === 'invalid_json') {
      return res.json({ reason: 'bad_request' });
    }
    console.error?.('[cart-link] unhandled_error', err);
    return res.status(500).json({ reason: 'internal_error' });
  }
}
