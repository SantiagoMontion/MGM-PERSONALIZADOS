import { normalizeVariantNumericId } from '@/lib/shopify.ts';

const DEFAULT_STORE_ORIGIN = 'https://www.mgmgamers.store';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveStoreOrigin(candidate, fallbackOrigin = DEFAULT_STORE_ORIGIN) {
  const base = typeof fallbackOrigin === 'string' && fallbackOrigin.trim()
    ? fallbackOrigin.trim()
    : DEFAULT_STORE_ORIGIN;
  if (typeof candidate === 'string' && candidate.trim()) {
    const raw = candidate.trim();
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`;
    } catch (err) {
      try {
        const parsed = new URL(raw, base);
        return `${parsed.protocol}//${parsed.host}`;
      } catch (nestedErr) {
        console.warn('[shopifyCartFallback] resolve_origin_failed', raw, nestedErr);
      }
    }
  }
  return base;
}

function clampQuantity(quantity) {
  const raw = Number(quantity);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.floor(raw));
}

async function fetchCartJson(cartEndpoint) {
  const resp = await fetch(cartEndpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });
  const text = await resp.text();
  if (!resp.ok) {
    const error = new Error('legacy_cart_fetch_failed');
    error.status = resp.status;
    error.body = text ? text.slice(0, 2000) : '';
    throw error;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const parseError = new Error('legacy_cart_parse_failed');
    parseError.body = text.slice(0, 2000);
    parseError.cause = err;
    throw parseError;
  }
}

function cartContainsVariant(cartJson, variantNumericId, expectedQuantity) {
  if (!cartJson || typeof cartJson !== 'object') return false;
  const lines = Array.isArray(cartJson.items)
    ? cartJson.items
    : Array.isArray(cartJson.line_items)
      ? cartJson.line_items
      : [];
  if (!lines.length) return false;
  const variantNumeric = Number(variantNumericId);
  const desired = clampQuantity(expectedQuantity);
  return lines.some((line) => {
    const lineVariant = Number(line?.variant_id ?? line?.variantId);
    if (!Number.isFinite(lineVariant)) return false;
    if (lineVariant !== variantNumeric) return false;
    const lineQuantity = Number(line?.quantity);
    if (!Number.isFinite(lineQuantity)) return true;
    return lineQuantity >= desired;
  });
}

async function verifyCartHasLine({ cartEndpoint, variantNumericId, quantity, retries = 3, delayMs = 250 }) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const json = await fetchCartJson(cartEndpoint);
      if (cartContainsVariant(json, variantNumericId, quantity)) {
        return true;
      }
    } catch (err) {
      console.warn('[shopifyCartFallback] cart_verify_failed', {
        attempt,
        message: err?.message,
        status: err?.status,
      });
    }
    await sleep(delayMs * (attempt + 1));
  }
  return false;
}

async function postCartAdd({ addEndpoint, variantNumericId, quantity }) {
  const payload = {
    items: [
      {
        id: Number(variantNumericId),
        quantity: clampQuantity(quantity),
      },
    ],
  };
  const resp = await fetch(addEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) {
    const error = new Error('legacy_add_http_error');
    error.status = resp.status;
    error.body = text ? text.slice(0, 2000) : '';
    throw error;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn('[shopifyCartFallback] add_response_parse_failed', err, { preview: text.slice(0, 200) });
    return null;
  }
}

export async function ensureLegacyCartAdd({
  variantId,
  quantity = 1,
  baseUrl,
  cartPlainUrl,
  attempts = 3,
  verifyDelayMs = 250,
}) {
  const variantNumericId = normalizeVariantNumericId(variantId);
  if (!variantNumericId) {
    throw new Error('legacy_missing_variant');
  }
  const origin = resolveStoreOrigin(baseUrl || cartPlainUrl);
  const addEndpoint = `${origin}/cart/add.js`;
  const cartEndpoint = `${origin}/cart.js`;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await postCartAdd({ addEndpoint, variantNumericId, quantity });
      const verified = await verifyCartHasLine({
        cartEndpoint,
        variantNumericId,
        quantity,
        retries: 3,
        delayMs: verifyDelayMs,
      });
      if (verified) {
        return { ok: true, origin };
      }
    } catch (err) {
      lastError = err;
      console.warn('[shopifyCartFallback] add_attempt_failed', {
        attempt,
        message: err?.message,
        status: err?.status,
      });
    }
    await sleep(verifyDelayMs * (attempt + 1));
  }
  const error = new Error('legacy_cart_add_failed');
  if (lastError) {
    error.cause = lastError;
  }
  throw error;
}
