import { resolveEnvRequirements, collectMissingEnv } from './_lib/envChecks.js';
import { createDiagId, logApiError } from './_lib/diag.js';
import { getAllowedOriginsFromEnv, resolveCorsDecision } from '../lib/cors.js';

const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';
const FRONT_ORIGIN = (process.env.FRONT_ORIGIN || 'https://mgm-app.vercel.app').replace(/\/$/, '');
const REQUIRED_ENV = resolveEnvRequirements('SHOPIFY_ADMIN', 'SUPABASE_SERVICE');
const SHOPIFY_TIMEOUT_STATUS = 504;
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MAX_PAYLOAD_SIZE_LIMIT = '20mb';
const CORS_ALLOW_HEADERS = 'content-type, authorization, x-diag';
const CORS_ALLOW_METHODS = 'POST, OPTIONS';
const CORS_MAX_AGE = '86400';

export const config = {
  memory: 256,
  maxDuration: 60,
  api: {
    bodyParser: true,
    sizeLimit: MAX_PAYLOAD_SIZE_LIMIT,
  },
};

function createRid() {
  const base = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${base}${random}`;
}

function resolveRequestedOrigin(req) {
  const header = req?.headers?.origin;
  if (Array.isArray(header)) {
    return header.find((value) => typeof value === 'string' && value.trim().length > 0);
  }
  return typeof header === 'string' ? header : undefined;
}

function applyCors(req, res) {
  const requestedOrigin = resolveRequestedOrigin(req);
  const allowList = getAllowedOriginsFromEnv();
  const decision = resolveCorsDecision(requestedOrigin, allowList);
  const resolvedOrigin = decision.allowed
    ? decision.allowedOrigin ?? decision.requestedOrigin ?? FRONT_ORIGIN
    : decision.allowedOrigin ?? FRONT_ORIGIN;

  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', resolvedOrigin || FRONT_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
    res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
    res.setHeader('Access-Control-Max-Age', CORS_MAX_AGE);
    res.setHeader('Vary', 'Origin');
  }
  return { decision, origin: resolvedOrigin };
}

function sendJsonWithCors(req, res, status, payload) {
  applyCors(req, res);
  if (typeof res.setHeader === 'function' && !res.getHeader?.('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  const body = payload == null ? {} : payload;
  const json = JSON.stringify(body);
  if (typeof res.json === 'function' && res.json !== sendJsonWithCors) {
    res.json(body);
  } else {
    res.end(json);
  }
}

function resolveShopDomain() {
  const candidates = [process.env.SHOPIFY_STORE_DOMAIN, process.env.SHOPIFY_SHOP];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function validateRealConfig(req, res, diagId) {
  const missing = collectMissingEnv(REQUIRED_ENV);
  if (missing.length) {
    logApiError('publish-product', { diagId, step: 'missing_env', error: `missing_env:${missing.join(',')}` });
    sendJsonWithCors(req, res, 400, { ok: false, error: 'missing_env', missing, diagId });
    return null;
  }

  const domain = resolveShopDomain();
  if (!domain || !/\.myshopify\.com$/i.test(domain)) {
    logApiError('publish-product', { diagId, step: 'invalid_shop_domain', error: domain || 'missing_domain' });
    sendJsonWithCors(req, res, 400, { ok: false, error: 'invalid_shop_domain', diagId });
    return null;
  }

  return { domain };
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'mock-product';
}

function getContentLengthHeader(req) {
  const raw = req?.headers?.['content-length'];
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const [, encodedPart] = dataUrl.split(',');
  const base64 = (encodedPart || '').trim();
  if (!base64) return null;
  const sanitized = base64.replace(/\s+/g, '');
  const padding = (sanitized.match(/=+$/) || [''])[0].length;
  if (sanitized.length === 0) return 0;
  const estimated = Math.floor((sanitized.length * 3) / 4) - padding;
  return estimated >= 0 ? estimated : 0;
}

function resolveBinaryLength(value) {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string') {
    return Buffer.byteLength(value);
  }
  if (Buffer.isBuffer(value)) {
    return value.length;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value && typeof value === 'object' && typeof value.length === 'number') {
    return Number.isFinite(value.length) ? value.length : null;
  }
  return null;
}

function estimatePayloadBytes(body) {
  if (!body || typeof body !== 'object') return null;

  if (typeof body.mockupDataUrl === 'string') {
    const bytes = estimateDataUrlBytes(body.mockupDataUrl);
    if (bytes != null) {
      return bytes;
    }
  }

  const candidates = [
    body.mockupBytes,
    body.mockupBuffer,
    body.mockupData,
    body.mockupBinary,
    body.buffer,
  ];

  for (const candidate of candidates) {
    const length = resolveBinaryLength(candidate);
    if (typeof length === 'number' && length >= 0) {
      return length;
    }
  }

  return null;
}

function respondPayloadTooLarge(req, res, diagId, estimatedBytes) {
  const payload = {
    ok: false,
    code: 'payload_too_large',
    limitBytes: MAX_PAYLOAD_BYTES,
    estimatedBytes: typeof estimatedBytes === 'number' ? estimatedBytes : null,
    hint: 'El dataURL base64 agrega ~33% de tamaño. Subí el archivo original < 15 MB o usá /api/upload-original.',
    diagId,
  };
  sendJsonWithCors(req, res, 413, payload);
}

async function obtainJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return { body: req.body, bytesRead: getContentLengthHeader(req) };
  }

  if (typeof req.body === 'string') {
    try {
      const raw = req.body;
      const parsed = JSON.parse(raw);
      req.body = parsed;
      return { body: parsed, bytesRead: Buffer.byteLength(raw, 'utf8') };
    } catch (err) {
      const invalid = new Error('invalid_body');
      invalid.code = 'invalid_body';
      throw invalid;
    }
  }

  return await new Promise((resolve, reject) => {
    let accumulated = '';
    let bytes = 0;

    const onData = (chunk) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buf.length;
      if (bytes > MAX_PAYLOAD_BYTES) {
        cleanup();
        const err = new Error('payload_too_large');
        err.code = 'payload_too_large';
        err.estimatedBytes = bytes;
        reject(err);
        return;
      }
      accumulated += buf.toString('utf8');
    };

    const onEnd = () => {
      cleanup();
      if (!accumulated) {
        const empty = {};
        req.body = empty;
        resolve({ body: empty, bytesRead: bytes });
        return;
      }
      try {
        const parsed = JSON.parse(accumulated);
        req.body = parsed;
        resolve({ body: parsed, bytesRead: bytes });
      } catch (err) {
        const invalid = new Error('invalid_body');
        invalid.code = 'invalid_body';
        reject(invalid);
      }
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      if (typeof req.removeListener === 'function') {
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
      }
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function buildMockProduct(payload) {
  const visibility = payload?.visibility === 'private' ? 'private' : 'public';
  const design = typeof payload?.designName === 'string' ? payload.designName.trim() : '';
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  const handleBase = design || title || 'mock-product';
  const handle = slugify(handleBase).slice(0, 64) || 'mock-product';
  const now = Date.now();
  const rid = createRid();
  const productId = `mock_${rid}`;
  const variantNumeric = `${Math.floor(Math.random() * 9_000_000) + 1_000_000}`;
  const variantGid = `gid://shopify/ProductVariant/${variantNumeric}`;
  const productUrl = `${FRONT_ORIGIN}/mockup?rid=${encodeURIComponent(rid)}&from=publish`;

  return {
    ok: true,
    stub: true,
    visibility,
    productId,
    productHandle: handle,
    handle,
    productUrl,
    url: productUrl,
    publicUrl: productUrl,
    variantId: variantGid,
    variantGid,
    variantIdNumeric: variantNumeric,
    createdAt: new Date(now).toISOString(),
    warnings: [],
    warningMessages: [],
  };
}

export default async function handler(req, res) {
  const diagId = createDiagId();
  const method = String(req.method || '').toUpperCase();

  if (method === 'OPTIONS') {
    applyCors(req, res);
    if (typeof res.setHeader === 'function') {
      res.setHeader('Allow', CORS_ALLOW_METHODS);
    }
    if (typeof res.status === 'function') {
      res.status(204);
    } else {
      res.statusCode = 204;
    }
    res.end();
    return;
  }

  if (method !== 'POST') {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Allow', 'POST, OPTIONS');
    }
    sendJsonWithCors(req, res, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  let parsedBody = {};
  let bytesRead = getContentLengthHeader(req);

  try {
    const { body, bytesRead: totalBytes } = await obtainJsonBody(req);
    if (body && typeof body === 'object') {
      parsedBody = body;
    }
    if (typeof totalBytes === 'number') {
      bytesRead = totalBytes;
    }
  } catch (err) {
    if (err?.code === 'payload_too_large') {
      const estimated = typeof err?.estimatedBytes === 'number' ? err.estimatedBytes : bytesRead ?? getContentLengthHeader(req);
      logApiError('publish-product', { diagId, step: 'payload_too_large', error: err });
      respondPayloadTooLarge(req, res, diagId, estimated);
      return;
    }
    logApiError('publish-product', { diagId, step: 'invalid_body', error: err });
    sendJsonWithCors(req, res, 400, { ok: false, error: 'invalid_body', diagId });
    return;
  }

  req.body = parsedBody;

  const estimatedBytes = estimatePayloadBytes(parsedBody);
  const headerBytes = typeof bytesRead === 'number' ? bytesRead : getContentLengthHeader(req);
  const effectiveEstimate = typeof estimatedBytes === 'number' ? estimatedBytes : headerBytes;

  if (typeof effectiveEstimate === 'number' && effectiveEstimate > MAX_PAYLOAD_BYTES) {
    logApiError('publish-product', {
      diagId,
      step: 'payload_too_large',
      error: `estimated_bytes:${effectiveEstimate}`,
    });
    respondPayloadTooLarge(req, res, diagId, effectiveEstimate);
    return;
  }

  if (!SHOPIFY_ENABLED) {
    const payload = { ...buildMockProduct(parsedBody || {}), diagId };
    sendJsonWithCors(req, res, 200, payload);
    return;
  }

  const configOk = validateRealConfig(req, res, diagId);
  if (!configOk) {
    return;
  }

  try {
    const mod = await import('../api-routes/publish-product.js');
    const realHandler = mod?.default || mod;
    if (typeof realHandler !== 'function') {
      logApiError('publish-product', { diagId, step: 'handler_missing', error: 'handler_not_found' });
      sendJsonWithCors(req, res, 200, { ok: true, stub: true, message: 'not_implemented', diagId });
      return;
    }
    req.mgmDiagId = diagId;
    await realHandler(req, res);
  } catch (err) {
    const step = err?.code === 'SHOPIFY_TIMEOUT' ? err?.step || 'shopify_request' : 'real_handler';
    logApiError('publish-product', { diagId, step, error: err });
    if (!res.headersSent) {
      if (err?.code === 'SHOPIFY_TIMEOUT') {
        sendJsonWithCors(req, res, SHOPIFY_TIMEOUT_STATUS, {
          ok: false,
          error: 'shopify_timeout',
          diagId,
          step,
        });
        return;
      }
      sendJsonWithCors(req, res, 502, {
        ok: false,
        error: 'publish_failed',
        diagId,
      });
    }
  }
}
