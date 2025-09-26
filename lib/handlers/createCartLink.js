import { z } from 'zod';
import { getPublicStorefrontBase } from '../publicStorefront.js';
import { shopifyStorefrontGraphQL } from '../shopify.js';
import { parseJsonBody, getClientIp } from '../_lib/http.js';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';

function normalizeVariantNumericId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

function ensureVariantGid(preferred, fallback, numericId) {
  const candidates = [preferred, fallback];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = String(candidate).trim();
    if (raw.startsWith('gid://')) return raw;
  }
  if (numericId) {
    return `gid://shopify/ProductVariant/${numericId}`;
  }
  return '';
}

function normalizeAttributeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const keyRaw = typeof entry.key === 'string' ? entry.key : typeof entry.name === 'string' ? entry.name : '';
  const key = String(keyRaw || '').trim();
  if (!key) return null;
  const valueRaw = entry.value ?? entry.val ?? entry.content ?? '';
  const value = String(valueRaw ?? '').trim();
  return {
    key: key.slice(0, 255),
    value: value.slice(0, 255),
  };
}

function collectCustomAttributes(input) {
  const out = [];
  if (Array.isArray(input)) {
    for (const entry of input) {
      const normalized = normalizeAttributeEntry(entry);
      if (normalized) out.push(normalized);
      if (out.length >= 20) break;
    }
    return out;
  }
  if (input && typeof input === 'object') {
    const entries = Object.entries(input);
    for (const [key, value] of entries) {
      const normalized = normalizeAttributeEntry({ key, value });
      if (normalized) out.push(normalized);
      if (out.length >= 20) break;
    }
  }
  return out;
}

function mergeAttributes(custom = []) {
  const seen = new Set();
  const result = [];
  const push = (key, value) => {
    const rawKey = typeof key === 'string' ? key.trim() : '';
    if (!rawKey) return;
    const normKey = rawKey.slice(0, 255);
    const dedupeKey = normKey.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const rawValue = value == null ? '' : String(value);
    result.push({ key: normKey, value: rawValue.slice(0, 255) });
  };
  push('mgm_source', 'editor');
  for (const attr of custom) {
    push(attr.key, attr.value);
    if (result.length >= 30) break;
  }
  return result;
}

function normalizeCartNote(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.slice(0, 1000);
}

async function fetchJobForCart(jobId) {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return { ok: false, reason: 'supabase_env_missing', error: err };
  }

  const { data, error } = await supabase
    .from('jobs')
    .select('shopify_variant_id, cart_url, checkout_url')
    .eq('job_id', jobId)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: 'supabase_error', detail: error.message };
  }
  if (!data) {
    return { ok: false, reason: 'job_not_found' };
  }
  return { ok: true, job: data };
}

function buildCartPermalink(variantNumericId, quantity) {
  if (!variantNumericId) return '';
  const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
  return `https://www.mgmgamers.store/cart/${variantNumericId}:${qty}?return_to=/cart`;
}

const PRECHECK_DELAYS = [0, 600, 1200, 2000, 2000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

const VARIANT_AVAILABILITY_QUERY = `
  query VariantAvailability($id: ID!) {
    node(id: $id) {
      ... on ProductVariant {
        id
        availableForSale
      }
    }
  }
`;

async function precheckVariantAvailability(variantGid, { maxAttempts = 3 } = {}) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid', attempts: 0 };
  }
  let attempts = 0;
  let lastReason = 'unknown';
  let lastStatus;
  let lastRequestId = '';
  for (let i = 0; i < maxAttempts; i += 1) {
    if (i > 0) {
      const delay = PRECHECK_DELAYS[Math.min(i, PRECHECK_DELAYS.length - 1)] || 600;
      await sleep(delay);
    }
    attempts += 1;
    let resp;
    try {
      resp = await shopifyStorefrontGraphQL(VARIANT_AVAILABILITY_QUERY, { id: variantGid });
    } catch (err) {
      if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
        return { ok: false, reason: 'storefront_env_missing', attempts, missing: err.missing };
      }
      throw err;
    }
    const requestId = readRequestId(resp);
    lastRequestId = requestId || lastRequestId;
    const text = await resp.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      lastReason = 'http_error';
      lastStatus = resp.status;
      continue;
    }
    if (!json || typeof json !== 'object') {
      lastReason = 'invalid_response';
      continue;
    }
    if (Array.isArray(json.errors) && json.errors.length) {
      lastReason = 'graphql_errors';
      continue;
    }
    const node = json?.data?.node;
    if (!node) {
      lastReason = 'not_found';
      continue;
    }
    if (node.availableForSale !== false) {
      return { ok: true, available: true, attempts, requestId };
    }
    lastReason = 'not_available';
  }
  return {
    ok: false,
    available: false,
    attempts,
    reason: lastReason,
    status: lastStatus,
    requestId: lastRequestId || undefined,
  };
}

const CART_CREATE_MUTATION = `
  mutation CartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

function buildStorefrontUrls({ cartId, checkoutUrl }) {
  if (!cartId) return {};
  const token = String(cartId).split('/').pop();
  if (!token) return {};
  const candidates = [];
  if (typeof checkoutUrl === 'string' && checkoutUrl.trim()) {
    try {
      const parsed = new URL(checkoutUrl);
      const origin = `${parsed.protocol}//${parsed.host}`;
      candidates.push(origin);
      return {
        cartUrl: `${origin}/cart/c/${token}`,
        checkoutUrl,
        cartPlain: `${origin}/cart`,
        checkoutPlain: `${origin}/checkout`,
        cartToken: token,
      };
    } catch {
      // ignore
    }
  }
  const base = getPublicStorefrontBase();
  if (base) {
    const normalized = base.replace(/\/$/, '');
    candidates.push(normalized);
    return {
      cartUrl: `${normalized}/cart/c/${token}`,
      checkoutUrl,
      cartPlain: `${normalized}/cart`,
      checkoutPlain: `${normalized}/checkout`,
      cartToken: token,
    };
  }
  return { cartToken: token };
}

const DEFAULT_COUNTRY_CODE = typeof process.env.SHOPIFY_CART_COUNTRY_CODE === 'string'
  ? process.env.SHOPIFY_CART_COUNTRY_CODE.trim() || 'AR'
  : 'AR';

const DEFAULT_PRESENTMENT = (() => {
  const envValue = typeof process.env.SHOPIFY_CART_PRESENTMENT_CURRENCY === 'string'
    ? process.env.SHOPIFY_CART_PRESENTMENT_CURRENCY.trim()
    : '';
  if (envValue) return envValue;
  if (DEFAULT_COUNTRY_CODE === 'AR') return 'ARS';
  return '';
})();

async function createStorefrontCart({ variantGid, quantity, buyerIp, attributes, note }) {
  if (!variantGid) {
    return { ok: false, reason: 'missing_variant_gid' };
  }
  const input = {
    lines: [
      {
        merchandiseId: variantGid,
        quantity,
      },
    ],
    buyerIdentity: {
      countryCode: DEFAULT_COUNTRY_CODE,
    },
  };
  if (DEFAULT_PRESENTMENT) {
    input.presentmentCurrencyCode = DEFAULT_PRESENTMENT;
  }
  const mergedAttributes = mergeAttributes(attributes);
  if (mergedAttributes.length) {
    input.attributes = mergedAttributes;
  }
  const noteValue = normalizeCartNote(note);
  if (noteValue) {
    input.note = noteValue;
  }
  let resp;
  try {
    resp = await shopifyStorefrontGraphQL(
      CART_CREATE_MUTATION,
      { input },
      { buyerIp },
    );
  } catch (err) {
    if (err?.message === 'SHOPIFY_STOREFRONT_ENV_MISSING') {
      return { ok: false, reason: 'storefront_env_missing', missing: err.missing };
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
    return { ok: false, reason: 'http_error', status: resp.status, body: text?.slice(0, 2000), requestId };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId };
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, reason: 'graphql_errors', errors: json.errors, requestId };
  }
  const cartCreate = json?.data?.cartCreate;
  if (!cartCreate || typeof cartCreate !== 'object') {
    return { ok: false, reason: 'invalid_response', requestId };
  }
  const userErrors = Array.isArray(cartCreate.userErrors)
    ? cartCreate.userErrors
        .map((err) => {
          if (!err || typeof err !== 'object') return null;
          const message = typeof err.message === 'string' ? err.message.trim() : '';
          if (!message) return null;
          const code = typeof err.code === 'string' ? err.code : undefined;
          const field = Array.isArray(err.field) ? err.field.map((item) => String(item)).filter(Boolean) : undefined;
          return { message, ...(code ? { code } : {}), ...(field && field.length ? { field } : {}) };
        })
        .filter(Boolean)
    : [];
  if (userErrors.length) {
    return { ok: false, reason: 'user_errors', userErrors, requestId };
  }
  const cart = cartCreate.cart;
  if (!cart || typeof cart !== 'object' || !cart.id) {
    return { ok: false, reason: 'missing_cart', requestId };
  }
  const urls = buildStorefrontUrls({ cartId: cart.id, checkoutUrl: cart.checkoutUrl });
  if (!urls.cartUrl) {
    return { ok: false, reason: 'missing_cart_url', requestId };
  }
  return {
    ok: true,
    cartUrl: urls.cartUrl,
    checkoutUrl: urls.checkoutUrl,
    cartPlain: urls.cartPlain,
    checkoutPlain: urls.checkoutPlain,
    cartId: cart.id,
    cartToken: urls.cartToken,
    requestId,
  };
}

const JobIdSchema = z
  .string()
  .trim()
  .min(8, 'job_id must be at least 8 characters')
  .max(64, 'job_id too long')
  .regex(/^[A-Za-z0-9_-]+$/, 'job_id has invalid characters');

const BodySchema = z
  .object({
    variantId: z.union([z.string(), z.number()]).optional(),
    variantGid: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    attributes: z.any().optional(),
    cartAttributes: z.any().optional(),
    note: z.any().optional(),
    job_id: JobIdSchema.optional(),
    jobId: JobIdSchema.optional(),
    discount: z.string().optional(),
  })
  .passthrough();

function respondWithPermalink(res, { variantNumericId, quantity, reason, requestId, userErrors }) {
  const webUrl = buildCartPermalink(variantNumericId, quantity);
  const cartPlain = 'https://www.mgmgamers.store/cart';
  const checkoutPlain = 'https://www.mgmgamers.store/checkout';
  try {
    console.warn('[create-cart-link] fallback_permalink', {
      variantNumericId,
      reason,
      requestId: requestId || null,
      userErrors: userErrors && userErrors.length ? userErrors : undefined,
    });
  } catch {}
  return res.status(200).json({
    ok: true,
    webUrl,
    url: webUrl,
    cart_url: webUrl,
    cart_url_follow: webUrl,
    cart_plain: cartPlain,
    checkout_url_now: undefined,
    checkout_plain: checkoutPlain,
    cart_method: 'permalink',
    reason,
  });
}

export default async function createCartLink(req, res) {
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
    const parsed = BodySchema.safeParse(body || {});
    if (!parsed.success) {
      return res.status(400).json({ reason: 'bad_request' });
    }
    const {
      variantId,
      variantGid: variantGidRaw,
      quantity,
      attributes: attrInput,
      cartAttributes,
      note,
      job_id: jobIdRaw,
      jobId: jobIdCamel,
      discount,
    } = parsed.data;

    const providedJobId = jobIdRaw || jobIdCamel || '';
    let variantNumericId = normalizeVariantNumericId(variantId ?? variantGidRaw);
    let variantGidValue = ensureVariantGid(variantGidRaw, variantId, variantNumericId);
    const normalizedDiscount = typeof discount === 'string' ? discount.trim() : '';

    if (!variantNumericId && providedJobId) {
      const jobResult = await fetchJobForCart(providedJobId);
      if (!jobResult.ok) {
        if (jobResult.reason === 'supabase_env_missing') {
          return res.status(500).json({ ok: false, error: 'supabase_env_missing' });
        }
        if (jobResult.reason === 'supabase_error') {
          return res.status(500).json({ ok: false, error: 'job_lookup_failed', detail: jobResult.detail });
        }
        if (jobResult.reason === 'job_not_found') {
          return res.status(404).json({ ok: false, error: 'job_not_found' });
        }
      } else {
        const { job } = jobResult;
        if (typeof job?.shopify_variant_id === 'string' && job.shopify_variant_id) {
          variantNumericId = normalizeVariantNumericId(job.shopify_variant_id);
          variantGidValue = ensureVariantGid(variantGidValue || job.shopify_variant_id, variantId, variantNumericId);
        }
        if (!variantNumericId && typeof job?.cart_url === 'string' && job.cart_url) {
          let cartUrlStored = job.cart_url;
          let checkoutUrlStored = typeof job.checkout_url === 'string' && job.checkout_url ? job.checkout_url : undefined;
          if (normalizedDiscount) {
            try {
              const cartUrlObj = new URL(cartUrlStored);
              cartUrlObj.searchParams.set('discount', normalizedDiscount);
              cartUrlStored = cartUrlObj.toString();
            } catch {}
            if (checkoutUrlStored) {
              try {
                const checkoutUrlObj = new URL(checkoutUrlStored);
                checkoutUrlObj.searchParams.set('discount', normalizedDiscount);
                checkoutUrlStored = checkoutUrlObj.toString();
              } catch {}
            }
          }
          let cartPlain;
          let checkoutPlain;
          try {
            const parsedCart = new URL(cartUrlStored);
            cartPlain = `${parsedCart.origin}/cart`;
          } catch {}
          if (checkoutUrlStored) {
            try {
              const parsedCheckout = new URL(checkoutUrlStored);
              checkoutPlain = `${parsedCheckout.origin}/checkout`;
            } catch {}
          }
          return res.status(200).json({
            ok: true,
            webUrl: cartUrlStored,
            url: cartUrlStored,
            cart_url: cartUrlStored,
            cart_url_follow: cartUrlStored,
            cart_plain: cartPlain,
            checkout_url_now: checkoutUrlStored,
            checkout_plain: checkoutPlain,
            cart_method: 'stored',
          });
        }
        if (!variantNumericId) {
          return res.status(409).json({ ok: false, error: 'job_variant_missing' });
        }
      }
    }

    if (!variantNumericId) {
      return res.status(400).json({ reason: 'bad_request' });
    }
    variantGidValue = ensureVariantGid(variantGidValue, variantId, variantNumericId);

    const qtyRaw = Number(quantity);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(Math.floor(qtyRaw), 99) : 1;

    const buyerIp = getClientIp(req);
    const attributes = collectCustomAttributes(cartAttributes ?? attrInput);

    let precheck;
    try {
      precheck = await precheckVariantAvailability(variantGidValue, { maxAttempts: 3 });
    } catch (err) {
      console.error?.('[create-cart-link] precheck_failed', {
        variantGid: variantGidValue,
        variantNumericId,
        error: err?.message || err,
      });
      return res.status(502).json({ reason: 'shopify_unreachable' });
    }

    if (!precheck.ok) {
      return respondWithPermalink(res, {
        variantNumericId,
        quantity: qty,
        reason: precheck.reason || 'precheck_failed',
        requestId: precheck.requestId,
      });
    }

    let storefrontAttempt;
    try {
      storefrontAttempt = await createStorefrontCart({
        variantGid: variantGidValue,
        quantity: qty,
        buyerIp,
        attributes,
        note,
      });
    } catch (err) {
      console.error?.('[create-cart-link] cart_create_network_error', {
        variantGid: variantGidValue,
        variantNumericId,
        error: err?.message || err,
      });
      return res.status(502).json({ reason: 'shopify_unreachable' });
    }

    if (storefrontAttempt.ok) {
      const payload = {
        ok: true,
        webUrl: storefrontAttempt.cartUrl,
        url: storefrontAttempt.cartUrl,
        cart_url: storefrontAttempt.cartUrl,
        cart_url_follow: storefrontAttempt.cartUrl,
        cart_plain: storefrontAttempt.cartPlain,
        checkout_url_now: storefrontAttempt.checkoutUrl,
        checkout_plain: storefrontAttempt.checkoutPlain,
        cart_id: storefrontAttempt.cartId,
        cart_token: storefrontAttempt.cartToken,
        cart_method: 'storefront',
      };
      return res.status(200).json(payload);
    }

    if (storefrontAttempt.reason === 'user_errors') {
      try {
        console.warn('[create-cart-link] cart_create_user_errors', {
          variantGid: variantGidValue,
          variantNumericId,
          requestId: storefrontAttempt.requestId || null,
          userErrors: storefrontAttempt.userErrors,
        });
      } catch {}
      try {
        const retryPrecheck = await precheckVariantAvailability(variantGidValue, { maxAttempts: 5 });
        if (retryPrecheck.ok) {
          try {
            storefrontAttempt = await createStorefrontCart({
              variantGid: variantGidValue,
              quantity: qty < 1 ? 1 : qty,
              buyerIp,
              attributes,
              note,
            });
            if (storefrontAttempt.ok) {
              const payload = {
                ok: true,
                webUrl: storefrontAttempt.cartUrl,
                url: storefrontAttempt.cartUrl,
                cart_url: storefrontAttempt.cartUrl,
                cart_url_follow: storefrontAttempt.cartUrl,
                cart_plain: storefrontAttempt.cartPlain,
                checkout_url_now: storefrontAttempt.checkoutUrl,
                checkout_plain: storefrontAttempt.checkoutPlain,
                cart_id: storefrontAttempt.cartId,
                cart_token: storefrontAttempt.cartToken,
                cart_method: 'storefront',
              };
              return res.status(200).json(payload);
            }
          } catch (err) {
            console.error?.('[create-cart-link] cart_create_retry_network_error', {
              variantGid: variantGidValue,
              variantNumericId,
              error: err?.message || err,
            });
            return res.status(502).json({ reason: 'shopify_unreachable' });
          }
        }
      } catch (err) {
        console.error?.('[create-cart-link] precheck_retry_failed', {
          variantGid: variantGidValue,
          variantNumericId,
          error: err?.message || err,
        });
        return res.status(502).json({ reason: 'shopify_unreachable' });
      }
    }

    return respondWithPermalink(res, {
      variantNumericId,
      quantity: qty,
      reason: storefrontAttempt.reason || 'storefront_failed',
      requestId: storefrontAttempt.requestId,
      userErrors: storefrontAttempt.userErrors,
    });
  } catch (e) {
    if (res.statusCode === 413) {
      return res.json({ ok: false, error: 'payload_too_large' });
    }
    if (res.statusCode === 400) {
      return res.json({ reason: 'bad_request' });
    }
    console.error?.('create_cart_link_error', e);
    return res.status(500).json({ ok: false, error: 'create_cart_link_failed' });
  }
}
