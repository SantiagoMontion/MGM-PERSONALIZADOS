import { resolveEnvRequirements, collectMissingEnv } from './_lib/envChecks.js';
import { createDiagId, logApiError } from './_lib/diag.js';
import {
  applyCors as applySharedCors,
  ensureCors,
  respondCorsDenied,
} from './_lib/cors.js';

const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';
const FRONT_ORIGIN = (process.env.FRONT_ORIGIN || 'https://mgm-app.vercel.app').replace(/\/$/, '');
const REQUIRED_ENV = resolveEnvRequirements('SHOPIFY_ADMIN', 'SUPABASE_SERVICE');
const SHOPIFY_TIMEOUT_STATUS = 504;

const ALLOWED_METHODS = 'POST, OPTIONS';
const ALLOWED_HEADERS = 'content-type, authorization, x-diag';
const BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10mb
const DATA_IMAGE_REGEX = /^data:image\//i;
const BASE64_FIELD_NAMES = new Set(['imagebase64', 'previewdataurl']);

function normalizePathSegment(segment) {
  if (typeof segment !== 'string') return '';
  return segment.trim().toLowerCase();
}

function isAllowedDataUrlPath(path) {
  if (!Array.isArray(path) || path.length === 0) {
    return false;
  }
  const normalized = path.map((segment) => normalizePathSegment(segment));
  const last = normalized[normalized.length - 1];
  if (!last) {
    return false;
  }
  const sanitizedLast = last.replace(/[^a-z0-9]+/g, '');
  if (!sanitizedLast.endsWith('dataurl')) {
    return false;
  }
  return normalized.some((segment) => segment.includes('mockup'));
}

export const config = {
  memory: 256,
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

function createRid() {
  const base = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${base}${random}`;
}

function applyCors(req, res, decision) {
  const resolved = applySharedCors(req, res, decision);
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  return resolved;
}

function sendJson(req, res, decision, status, payload) {
  applyCors(req, res, decision);
  res.statusCode = status;
  res.end(JSON.stringify(payload ?? {}));
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

function validateRealConfig(req, res, diagId, decision) {
  const missing = collectMissingEnv(REQUIRED_ENV);
  if (missing.length) {
    logApiError('publish-product', { diagId, step: 'missing_env', error: `missing_env:${missing.join(',')}` });
    sendJson(req, res, decision, 400, { ok: false, error: 'missing_env', missing, diagId });
    return null;
  }

  const domain = resolveShopDomain();
  if (!domain || !/\.myshopify\.com$/i.test(domain)) {
    logApiError('publish-product', { diagId, step: 'invalid_shop_domain', error: domain || 'missing_domain' });
    sendJson(req, res, decision, 400, { ok: false, error: 'invalid_shop_domain', diagId });
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

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let finished = false;

    const cleanup = () => {
      req.off?.('data', onData);
      req.off?.('end', onEnd);
      req.off?.('error', onError);
    };

    const abort = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        req.pause?.();
        req.destroy?.();
      } catch {}
      reject(err);
    };

    const onData = (chunk) => {
      if (finished) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (BODY_LIMIT_BYTES > 0 && total > BODY_LIMIT_BYTES) {
        const err = new Error('payload_too_large');
        err.code = 'payload_too_large';
        abort(err);
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      if (total === 0) {
        resolve(null);
        return;
      }
      try {
        const text = Buffer.concat(chunks, total).toString('utf8');
        resolve(JSON.parse(text));
      } catch (err) {
        err.code = err.code || 'invalid_json';
        reject(err);
      }
    };

    const onError = (err) => {
      abort(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function sanitizeBase64Payload(value) {
  if (!value || typeof value !== 'object') {
    return { sanitized: value, removed: [] };
  }

  const removed = new Set();

  const visit = (current, path) => {
    if (current == null) {
      return current;
    }

    if (typeof current === 'string') {
      if (DATA_IMAGE_REGEX.test(current)) {
        if (isAllowedDataUrlPath(path)) {
          return current;
        }
        removed.add(path.join('.'));
        return undefined;
      }
      return current;
    }

    if (Array.isArray(current)) {
      const next = [];
      current.forEach((entry, index) => {
        const result = visit(entry, path.concat(String(index)));
        if (result !== undefined) {
          next.push(result);
        }
      });
      return next;
    }

    const next = {};
    for (const [key, rawValue] of Object.entries(current)) {
      const lowered = key.toLowerCase();
      const nextPath = path.concat(key);
      if (BASE64_FIELD_NAMES.has(lowered)) {
        removed.add(nextPath.join('.'));
        continue;
      }
      const result = visit(rawValue, nextPath);
      if (result !== undefined) {
        next[key] = result;
      }
    }
    return next;
  };

  const sanitized = visit(value, []);
  return { sanitized, removed: Array.from(removed) };
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
  const corsDecision = ensureCors(req, res);
  const appliedDecision = applyCors(req, res, corsDecision);

  if (!appliedDecision.allowed || !appliedDecision.allowedOrigin) {
    respondCorsDenied(req, res, appliedDecision, diagId);
    return;
  }

  if ((req.method || '').toUpperCase() === 'OPTIONS') {
    res.setHeader('Allow', ALLOWED_METHODS);
    applyCors(req, res, appliedDecision);
    res.statusCode = 204;
    res.end();
    return;
  }

  if ((req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', ALLOWED_METHODS);
    sendJson(req, res, appliedDecision, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  let incomingBody = null;
  try {
    incomingBody = await readJsonBody(req);
  } catch (err) {
    if (err?.code === 'payload_too_large') {
      sendJson(req, res, appliedDecision, 413, { ok: false, error: 'payload_too_large', diagId });
      return;
    }
    logApiError('publish-product', { diagId, step: 'invalid_body', error: err });
    sendJson(req, res, appliedDecision, 400, { ok: false, error: 'invalid_body', diagId });
    return;
  }

  const { sanitized: sanitizedBody, removed: removedPaths } = sanitizeBase64Payload(
    incomingBody && typeof incomingBody === 'object' ? incomingBody : {},
  );

  if (removedPaths.length) {
    logApiError('publish-product', {
      diagId,
      step: 'base64_removed',
      removed: removedPaths,
    });
  }

  req.body = sanitizedBody;

  if (!SHOPIFY_ENABLED) {
    const payload = { ...buildMockProduct(sanitizedBody || {}), diagId };
    sendJson(req, res, appliedDecision, 200, payload);
    return;
  }

  const configOk = validateRealConfig(req, res, diagId, appliedDecision);
  if (!configOk) {
    return;
  }

  try {
    const mod = await import('../api-routes/publish-product.js');
    const realHandler = mod?.default || mod;
    if (typeof realHandler !== 'function') {
      logApiError('publish-product', { diagId, step: 'handler_missing', error: 'handler_not_found' });
      sendJson(req, res, appliedDecision, 200, { ok: true, stub: true, message: 'not_implemented', diagId });
      return;
    }
    req.mgmDiagId = diagId;
    await realHandler(req, res);
  } catch (err) {
    const step = err?.code === 'SHOPIFY_TIMEOUT' ? err?.step || 'shopify_request' : 'real_handler';
    logApiError('publish-product', { diagId, step, error: err });
    if (!res.headersSent) {
      if (err?.code === 'SHOPIFY_TIMEOUT') {
        sendJson(req, res, appliedDecision, SHOPIFY_TIMEOUT_STATUS, {
          ok: false,
          error: 'shopify_timeout',
          diagId,
          step,
        });
        return;
      }
      sendJson(req, res, appliedDecision, 502, {
        ok: false,
        error: 'publish_failed',
        diagId,
      });
    }
  }
}
