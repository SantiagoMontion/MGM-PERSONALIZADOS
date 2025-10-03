const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';
const FRONT_ORIGIN = (process.env.FRONT_ORIGIN || 'https://mgm-app.vercel.app').replace(/\/$/, '');

export const config = { memory: 256, maxDuration: 10 };

function applyCors(req, res) {
  const origin = typeof req?.headers?.origin === 'string' && req.headers.origin ? req.headers.origin : '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function sendJson(req, res, status, payload) {
  applyCors(req, res);
  res.statusCode = status;
  res.end(JSON.stringify(payload ?? {}));
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('payload_too_large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function clampQuantity(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.min(99, Math.max(1, Math.floor(num)));
}

function buildMockCartResponse(payload) {
  const now = Date.now();
  const random = Math.floor(Math.random() * 1_000_000);
  const suffix = `${now}${random}`.slice(-12);
  const cartId = typeof payload?.cartId === 'string' && payload.cartId.trim()
    ? payload.cartId.trim()
    : `mock-cart-${suffix}`;
  const variantGid = typeof payload?.variantGid === 'string' && payload.variantGid.trim()
    ? payload.variantGid.trim()
    : `gid://shopify/ProductVariant/${suffix}`;
  const quantity = clampQuantity(payload?.quantity);
  const sku = variantGid.split('/').pop() || `mock-sku-${suffix}`;
  const rid = cartId;
  const checkoutUrl = `${FRONT_ORIGIN}/mockup?rid=${encodeURIComponent(rid)}&step=checkout`;
  return {
    ok: true,
    stub: true,
    cartId,
    variantGid,
    line: { sku, qty: quantity },
    quantity,
    url: checkoutUrl,
    cartUrl: checkoutUrl,
    cartWebUrl: checkoutUrl,
    cartPlain: checkoutUrl,
    checkoutUrl,
    checkoutPlain: checkoutUrl,
    cartToken: `mock-token-${suffix}`,
    usedFallback: false,
    requestId: `mock-request-${suffix}`,
  };
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }
  if ((req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendJson(req, res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  if (!SHOPIFY_ENABLED) {
    let body = null;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      body = null;
    }
    const payload = buildMockCartResponse(body || {});
    sendJson(req, res, 200, payload);
    return;
  }

  try {
    const mod = await import('../../api-routes/cart/add.js');
    const realHandler = mod?.default || mod;
    if (typeof realHandler !== 'function') {
      sendJson(req, res, 200, { ok: true, stub: true, message: 'not_implemented' });
      return;
    }
    await realHandler(req, res);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(req, res, 200, { ok: true, stub: true, message: 'not_implemented' });
    }
  }
}
