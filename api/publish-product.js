import { resolveEnvRequirements, collectMissingEnv } from './_lib/envChecks.js';
import { createDiagId, logApiError } from './_lib/diag.js';
import { getAllowedOriginsFromEnv, resolveCorsDecision } from '../lib/cors.js';

const SHOPIFY_ENABLED = process.env.SHOPIFY_ENABLED === '1';
const FRONT_ORIGIN = (process.env.FRONT_ORIGIN || 'https://mgm-app.vercel.app').replace(/\/$/, '');
const REQUIRED_ENV = resolveEnvRequirements('SHOPIFY_ADMIN', 'SUPABASE_SERVICE');
const SHOPIFY_TIMEOUT_STATUS = 504;
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;


function sanitizeShopifyImageUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  const noQuery = trimmed.split('?')[0].trim();
  if (!noQuery) return '';
  try {
    const parsed = new URL(noQuery);
    return encodeURI(`${parsed.origin}${parsed.pathname}`);
  } catch {
    return encodeURI(noQuery);
  }
}

const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
const CORS_ALLOW_HEADERS = 'content-type, authorization, x-diag';
const CORS_ALLOW_METHODS = 'POST, OPTIONS';
const CORS_MAX_AGE = '86400';
const DEDUPE_TTL_MS = 5 * 60 * 1000;
const inFlightPublishByFingerprint = new Map();
const recentPublishByFingerprint = new Map();

export const config = {
  memory: 256,
  maxDuration: 60,
  api: {
    bodyParser: true,
    sizeLimit: '32mb',
  },
};

function normalizeMaterialFromProductType(productType) {
  const normalized = String(productType || '').toLowerCase();
  if (normalized.includes('glass')) return 'Glasspad';
  if (normalized.includes('pro')) return 'PRO';
  if (normalized.includes('alfombr')) return 'Alfombra';
  if (normalized.includes('classic')) return 'Classic';
  return 'Classic';
}

function parseMoney(value) {
  if (value && typeof value === 'object') {
    const amountCandidate = value.amount ?? value.value ?? value.price ?? null;
    return parseMoney(amountCandidate);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  const sanitized = raw.replace(/[^0-9,.-]/g, '');
  const normalized = sanitized
    .replace(/,/g, '')
    .replace(/\.(?=.*\.)/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

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

function cleanExpiredPublishCache(now = Date.now()) {
  for (const [key, value] of recentPublishByFingerprint.entries()) {
    if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) {
      recentPublishByFingerprint.delete(key);
    }
  }
}

function buildPublishFingerprint({ designHash, widthCm, heightCm }) {
  const hash = typeof designHash === 'string' ? designHash.trim().toLowerCase() : '';
  const width = Number(widthCm);
  const height = Number(heightCm);
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  if (!Number.isFinite(width) || width <= 0) return null;
  if (!Number.isFinite(height) || height <= 0) return null;
  return `${hash}|${Math.round(width)}x${Math.round(height)}`;
}

function captureJsonResponse(res) {
  let settled = false;
  let resolveCapture;
  const capturePromise = new Promise((resolve) => {
    resolveCapture = resolve;
  });
  const settle = (capture) => {
    if (settled) return;
    settled = true;
    resolveCapture(capture);
  };

  const originalStatus = typeof res.status === 'function' ? res.status.bind(res) : null;
  const originalJson = typeof res.json === 'function' ? res.json.bind(res) : null;
  const originalEnd = typeof res.end === 'function' ? res.end.bind(res) : null;

  let statusCode = Number.isFinite(res?.statusCode) ? res.statusCode : 200;

  if (originalStatus) {
    res.status = (code) => {
      if (Number.isFinite(code)) statusCode = code;
      return originalStatus(code);
    };
  }

  if (originalJson) {
    res.json = (body) => {
      settle({ status: statusCode, body });
      return originalJson(body);
    };
  }

  if (originalEnd) {
    res.end = (chunk, encoding, cb) => {
      if (!settled) {
        let parsed = null;
        if (typeof chunk === 'string' && chunk.trim()) {
          try { parsed = JSON.parse(chunk); } catch {}
        } else if (Buffer.isBuffer(chunk) && chunk.length) {
          try { parsed = JSON.parse(chunk.toString('utf8')); } catch {}
        }
        if (parsed && typeof parsed === 'object') {
          settle({ status: statusCode, body: parsed });
        }
      }
      return originalEnd(chunk, encoding, cb);
    };
  }

  return {
    done: capturePromise,
    restore() {
      if (originalStatus) res.status = originalStatus;
      if (originalJson) res.json = originalJson;
      if (originalEnd) res.end = originalEnd;
    },
    settleFallback() {
      if (!settled) settle({ status: statusCode, body: null });
    },
  };
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

  const mockupDataUrl = typeof body.mockupDataUrl === 'string' ? body.mockupDataUrl : null;
  if (mockupDataUrl) {
    const bytes = estimateDataUrlBytes(mockupDataUrl);
    if (bytes != null) {
      return bytes;
    }
  }

  const mockupUrl = typeof body.mockupUrl === 'string' ? body.mockupUrl : null;
  if (mockupUrl && mockupUrl.startsWith('data:')) {
    const bytes = estimateDataUrlBytes(mockupUrl);
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
      if (bytes > MAX_REQUEST_BODY_BYTES) {
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

  const mockupPublicRaw = sanitizeShopifyImageUrl(typeof parsedBody.mockupPublicUrl === 'string' ? parsedBody.mockupPublicUrl : '');
  const mockupHashRaw = typeof parsedBody.mockupHash === 'string' ? parsedBody.mockupHash.trim() : '';
  const pdfUrlRaw = typeof parsedBody.pdfPublicUrl === 'string' ? parsedBody.pdfPublicUrl.trim() : '';
  const designHashRaw = typeof parsedBody.designHash === 'string' ? parsedBody.designHash.trim().toLowerCase() : '';
  if (!mockupPublicRaw || mockupPublicRaw.startsWith('blob:')) {
    sendJsonWithCors(req, res, 400, { ok: false, error: 'mockup_missing', code: 'mockup_missing', diagId });
    return;
  }
  const mockupHash = /^[a-f0-9]{8}$/i.test(mockupHashRaw) ? mockupHashRaw.toLowerCase() : '';
  if (!mockupHash) {
    sendJsonWithCors(req, res, 400, { ok: false, error: 'mockup_hash_invalid', code: 'mockup_hash_invalid', diagId });
    return;
  }
  const effectiveMockupUrl = mockupPublicRaw;
  if (!pdfUrlRaw) {
    sendJsonWithCors(req, res, 400, { ok: false, error: 'pdf_url_required', diagId });
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(designHashRaw)) {
    sendJsonWithCors(req, res, 400, { ok: false, error: 'design_hash_invalid', diagId });
    return;
  }

  const masterWidthPx = Number(parsedBody.masterWidthPx ?? parsedBody.master_width_px);
  const masterHeightPx = Number(parsedBody.masterHeightPx ?? parsedBody.master_height_px);
  if (parsedBody.masterWidthPx != null && (!Number.isFinite(masterWidthPx) || masterWidthPx <= 0)) {
    sendJsonWithCors(req, res, 400, { ok: false, error: 'master_width_invalid', diagId });
    return;
  }
  if (parsedBody.masterHeightPx != null && (!Number.isFinite(masterHeightPx) || masterHeightPx <= 0)) {
    sendJsonWithCors(req, res, 400, { ok: false, error: 'master_height_invalid', diagId });
    return;
  }

  const versionedMockupUrl = mockupPublicRaw ? `${mockupPublicRaw}?v=${mockupHash}` : '';
  parsedBody.mockupUrl = versionedMockupUrl;
  parsedBody.mockupPublicUrl = mockupPublicRaw;
  parsedBody.mockupHash = mockupHash;
  parsedBody.pdfPublicUrl = pdfUrlRaw;
  parsedBody.designHash = designHashRaw;
  parsedBody.masterWidthPx = Number.isFinite(masterWidthPx) && masterWidthPx > 0 ? Math.round(masterWidthPx) : null;
  parsedBody.masterHeightPx = Number.isFinite(masterHeightPx) && masterHeightPx > 0 ? Math.round(masterHeightPx) : null;

  // Material canónico: usar lo que llegó del front (no adivinar salvo fallback explícito)
  try {
    console.log('[audit:publish-product:incoming]', {
      diagId,
      material: parsedBody?.material,
      materialResolved: parsedBody?.materialResolved,
      optionsMaterial: parsedBody?.options?.material,
      widthCm: parsedBody?.widthCm,
      heightCm: parsedBody?.heightCm,
      priceTransfer: parsedBody?.priceTransfer,
      price: parsedBody?.price,
      title: parsedBody?.title,
    });
  } catch (_) {
    // noop
  }

  let productType = String(
    parsedBody?.options?.productType
      ?? parsedBody?.productType
      ?? 'mousepad',
  ).trim().toLowerCase() || 'mousepad';
  const mat = normalizeMaterialFromProductType(productType);
  let widthCmSafe = Number(parsedBody?.widthCm ?? NaN);
  let heightCmSafe = Number(parsedBody?.heightCm ?? NaN);
  if (Number.isFinite(widthCmSafe) && widthCmSafe > 0) {
    widthCmSafe = Math.round(widthCmSafe);
  }
  if (Number.isFinite(heightCmSafe) && heightCmSafe > 0) {
    heightCmSafe = Math.round(heightCmSafe);
  }
  if (mat === 'Glasspad') {
    widthCmSafe = 49;
    heightCmSafe = 42;
  }
  if (!Number.isFinite(widthCmSafe) || widthCmSafe <= 0) {
    widthCmSafe = undefined;
  }
  if (!Number.isFinite(heightCmSafe) || heightCmSafe <= 0) {
    heightCmSafe = undefined;
  }
  const NAME_MAX_LEN = Number(process.env.NAME_MAX_LEN || 40);
  const normalizeDesignNameKeepSpaces = (value) => {
    const str = String(value ?? '').replace(/[\r\n\t]+/g, ' ');
    const trimmed = str.trim();
    return trimmed.slice(0, NAME_MAX_LEN);
  };
  const designNameRaw = (
    parsedBody.designName
      ?? parsedBody.design_name
      ?? parsedBody.name
      ?? ''
  );
  const designNameNorm = normalizeDesignNameKeepSpaces(designNameRaw);
  const designName = designNameNorm.length ? designNameNorm : 'Personalizado';
  const hasDims = Number.isFinite(widthCmSafe) && Number.isFinite(heightCmSafe) && widthCmSafe > 0 && heightCmSafe > 0;
  const productLabel = productType.includes('glass')
    ? 'Glasspad'
    : mat === 'Alfombra'
      ? 'Alfombra'
      : 'Mousepad';
  const nameParts = [
    productLabel,
    designName,
    hasDims ? `${widthCmSafe}x${heightCmSafe}` : '',
    productLabel === 'Mousepad' ? mat : '',
  ].filter(Boolean);
  const computedTitle = designName
    ? `${nameParts.join(' ')} | MGM-EDITOR`
    : parsedBody.title;
  const finalTitle = typeof parsedBody.title === 'string' && parsedBody.title.includes('| MGM-EDITOR')
    ? parsedBody.title
    : computedTitle;
  parsedBody.materialResolved = mat;
  parsedBody.options = { ...(parsedBody.options || {}), material: mat, productType };
  parsedBody.productType = productType;
  parsedBody.widthCm = Number.isFinite(widthCmSafe) && widthCmSafe > 0 ? widthCmSafe : undefined;
  parsedBody.heightCm = Number.isFinite(heightCmSafe) && heightCmSafe > 0 ? heightCmSafe : undefined;
  const publishFingerprint = buildPublishFingerprint({
    designHash: parsedBody.designHash,
    widthCm: parsedBody.widthCm,
    heightCm: parsedBody.heightCm,
  });
  if (publishFingerprint) {
    parsedBody.publishFingerprint = publishFingerprint;
  }
  const idempotencySuffix = String(parsedBody?.material || parsedBody?.materialResolved || mat || 'material')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  parsedBody.shopifyIdempotencyKey = `publish:${designHashRaw}:${idempotencySuffix || 'material'}`.slice(0, 255);
  parsedBody.title = finalTitle;
  const priceTransfer = parseMoney(
    parsedBody.priceTransfer ?? parsedBody.price_transfer ?? parsedBody.priceTranferencia,
  );
  const priceNormal = parseMoney(
    parsedBody.priceNormal ?? parsedBody.price_normal ?? parsedBody.price,
  );
  // Precio: usar SIEMPRE priceTransfer (tolerar string con miles/comas); si no hay, caer a priceNormal
  const priceValue = Number.isFinite(priceTransfer) && priceTransfer > 0
    ? priceTransfer
    : Number.isFinite(priceNormal)
      ? priceNormal
      : 0;
  const normalizedPriceValue = Number(priceValue);
  if (!Number.isFinite(normalizedPriceValue) || normalizedPriceValue <= 0) {
    sendJsonWithCors(req, res, 400, {
      ok: false,
      error: 'precio_invalido',
      reason: 'precio_invalido',
      message: 'El precio debe ser mayor a 0 para publicar en Shopify.',
      diagId,
    });
    return;
  }
  const currencyValue = String(parsedBody.currency || process.env.SHOPIFY_CART_PRESENTMENT_CURRENCY || 'USD');
  parsedBody.price = normalizedPriceValue;
  parsedBody.currency = currencyValue;
  const modeFromBody = typeof parsedBody.mode === 'string' ? parsedBody.mode.trim().toLowerCase() : '';
  const isPrivate = parsedBody.private === true
    || modeFromBody === 'private'
    || req?.query?.private === '1';
  parsedBody.private = Boolean(isPrivate);
  parsedBody.isPrivate = Boolean(isPrivate);
  const existingMetafields = Array.isArray(parsedBody.metafields) ? parsedBody.metafields : [];
  const preservedMetafields = existingMetafields.filter(
    (entry) => !entry || typeof entry !== 'object'
      ? true
      : entry.namespace !== 'custom' || entry.key !== 'private',
  );
  const privateMetafield = {
    namespace: 'custom',
    key: 'private',
    type: 'boolean',
    value: isPrivate ? 'true' : 'false',
  };
  parsedBody.metafields = [...preservedMetafields, privateMetafield];
  try {
    console.log('[audit:metafields]', {
      namespace: privateMetafield.namespace,
      key: privateMetafield.key,
      type: privateMetafield.type,
      value: privateMetafield.value,
    });
  } catch (_) {
    // noop
  }
  // Pasar mockupUrl simple; la imagen se adjunta en el handler vía REST
  parsedBody.mockupUrl = versionedMockupUrl;
  // Diags para verificar qué llegó y qué se usó
  try {
    console.log('[audit:publish-product:resolved]', {
      diagId,
      materialLabelFinal: mat,
      widthCmFinal: widthCmSafe,
      heightCmFinal: heightCmSafe,
      priceFinal: priceValue,
      titleFinal: finalTitle,
    });
  } catch (logErr) {
    // noop
  }

  try {
    const images = [];
    const dataUrl = typeof parsedBody.mockupDataUrl === 'string' ? parsedBody.mockupDataUrl.trim() : '';
    const fallbackName = designName || 'Mockup';
    const filename = `${fallbackName}.png`;
    if (dataUrl.startsWith('data:image')) {
      const base64 = (dataUrl.split(',')[1] || '').trim();
      if (base64) {
        images.push({ attachment: base64, filename, altText: fallbackName });
      }
    } else {
      const mockupUrlValue = sanitizeShopifyImageUrl(typeof parsedBody.mockupUrl === 'string' ? parsedBody.mockupUrl : '');
      if (mockupUrlValue.startsWith('data:image')) {
        const base64 = (mockupUrlValue.split(',')[1] || '').trim();
        if (base64) {
          images.push({ attachment: base64, filename, altText: fallbackName });
        }
      } else if (mockupUrlValue) {
        images.push({ src: mockupUrlValue, altText: fallbackName });
      }
    }
    if (images.length) {
      parsedBody.images = images;
    }
  } catch (_) {
    // no bloquear
  }

  if (typeof parsedBody.mockupDataUrl === 'string' && parsedBody.mockupDataUrl.length > 200000) {
    sendJsonWithCors(req, res, 400, { ok: false, error: 'mockup_dataurl_too_large', diagId });
    return;
  }
  delete parsedBody.mockupDataUrl;
  delete parsedBody.mockupBytes;
  delete parsedBody.mockupBuffer;
  delete parsedBody.mockupBinary;
  delete parsedBody.mockupData;

  try {
    const serialized = JSON.stringify(parsedBody ?? {});
    if (serialized && Buffer.byteLength(serialized, 'utf8') > 300_000) {
      logApiError('publish-product', { diagId, step: 'payload_json_too_large', error: 'payload_json_too_large' });
      sendJsonWithCors(req, res, 413, { ok: false, error: 'payload_too_large_defense', diagId });
      return;
    }
  } catch (stringifyErr) {
    logApiError('publish-product', { diagId, step: 'payload_stringify_failed', error: stringifyErr });
    sendJsonWithCors(req, res, 400, { ok: false, error: 'invalid_body', diagId });
    return;
  }

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
    cleanExpiredPublishCache();
    if (publishFingerprint) {
      const inflight = inFlightPublishByFingerprint.get(publishFingerprint);
      if (inflight?.promise) {
        console.warn('🛡️ Idempotencia activada: Pedido duplicado detectado para hash:', designHashRaw);
        const replay = await inflight.promise;
        if (replay?.body && Number.isFinite(replay?.status)) {
          sendJsonWithCors(req, res, replay.status, replay.body);
          return;
        }
      }
      const recent = recentPublishByFingerprint.get(publishFingerprint);
      if (recent?.body && Number.isFinite(recent?.status) && Number.isFinite(recent?.expiresAt) && recent.expiresAt > Date.now()) {
        console.warn('🛡️ Idempotencia activada: Pedido duplicado detectado para hash:', designHashRaw);
        sendJsonWithCors(req, res, recent.status, recent.body);
        return;
      }
    }

    const capture = captureJsonResponse(res);
    const publishExecution = (async () => {
      try {
        await realHandler(req, res);
      } finally {
        capture.settleFallback();
        capture.restore();
      }
      return capture.done;
    })();

    if (publishFingerprint) {
      inFlightPublishByFingerprint.set(publishFingerprint, { promise: publishExecution });
    }

    const settled = await publishExecution;
    if (publishFingerprint && settled?.body && Number.isFinite(settled?.status)) {
      recentPublishByFingerprint.set(publishFingerprint, {
        status: settled.status,
        body: settled.body,
        expiresAt: Date.now() + DEDUPE_TTL_MS,
      });
    }
    if (publishFingerprint) {
      inFlightPublishByFingerprint.delete(publishFingerprint);
    }
  } catch (err) {
    if (publishFingerprint) {
      inFlightPublishByFingerprint.delete(publishFingerprint);
    }
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
