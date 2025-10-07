import { randomUUID } from 'node:crypto';
import publishProduct from '../lib/handlers/publishProduct.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';
import { ensureCors, respondCorsDenied } from '../lib/cors.js';

const PAYLOAD_LIMIT_BYTES = 20 * 1024 * 1024; // 20 MiB
const PAYLOAD_TOO_LARGE_HINT = 'El dataURL base64 agrega ~33% de tamaño. Subí el archivo original < 15 MB o usá /api/upload-original.';

function sanitizeBase64Payload(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, '');
}

function estimateBase64Bytes(base64) {
  const sanitized = sanitizeBase64Payload(base64);
  if (!sanitized) return null;
  const length = sanitized.length;
  if (!length) return 0;
  let padding = 0;
  if (sanitized.endsWith('==')) padding = 2;
  else if (sanitized.endsWith('=')) padding = 1;
  const estimate = Math.floor((length * 3) / 4) - padding;
  return estimate > 0 ? estimate : 0;
}

function resolveBinaryLength(candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }
  if (Buffer.isBuffer(candidate)) {
    return candidate.length;
  }
  if (candidate instanceof ArrayBuffer) {
    return candidate.byteLength;
  }
  if (ArrayBuffer.isView?.(candidate) && typeof candidate.byteLength === 'number') {
    return candidate.byteLength;
  }
  if (typeof candidate === 'object' && typeof candidate.size === 'number') {
    return candidate.size;
  }
  if (Array.isArray(candidate)) {
    return candidate.length;
  }
  return null;
}

function estimatePayloadBytes(body) {
  if (!body || typeof body !== 'object') return null;

  if (typeof body.mockupDataUrl === 'string') {
    const [, base64Part = ''] = body.mockupDataUrl.split(',');
    const estimated = estimateBase64Bytes(base64Part);
    if (typeof estimated === 'number' && estimated > 0) {
      return estimated;
    }
  }

  const binaryCandidates = [
    body.mockupBuffer,
    body.mockupBytes,
    body.mockupArray,
    body.mockupArrayBuffer,
    body.mockupBinary,
    body.mockup,
  ];

  for (const candidate of binaryCandidates) {
    const length = resolveBinaryLength(candidate);
    if (typeof length === 'number' && length > 0) {
      return length;
    }
  }

  return null;
}

function applyCustomCorsHeaders(res) {
  res.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader?.('Access-Control-Allow-Headers', 'content-type, authorization, x-diag');
  res.setHeader?.('Access-Control-Max-Age', '86400');
}

function respondWithCorsJson(req, res, status, payload) {
  const decision = ensureCors(req, res);
  if (!decision?.allowed || !decision?.allowedOrigin) {
    const diagId = randomUUID();
    respondCorsDenied(req, res, decision, diagId);
    return;
  }

  applyCustomCorsHeaders(res);

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status);
    res.json(payload);
    return;
  }

  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }

  try {
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  } catch {}

  const body = JSON.stringify(payload);
  if (typeof res.end === 'function') {
    res.end(body);
  } else if (typeof res.send === 'function') {
    res.send(body);
  }
}

function handleOptions(req, res) {
  const decision = ensureCors(req, res);
  if (!decision?.allowed || !decision?.allowedOrigin) {
    const diagId = randomUUID();
    respondCorsDenied(req, res, decision, diagId);
    return;
  }

  applyCustomCorsHeaders(res);

  if (typeof res.status === 'function') {
    res.status(204);
  } else {
    res.statusCode = 204;
  }

  if (typeof res.end === 'function') {
    res.end();
  } else if (typeof res.send === 'function') {
    res.send('');
  }
}

function enforcePayloadLimit(req, res) {
  const estimatedBytes = estimatePayloadBytes(req?.body);
  if (typeof estimatedBytes === 'number' && estimatedBytes > PAYLOAD_LIMIT_BYTES) {
    respondWithCorsJson(req, res, 413, {
      ok: false,
      reason: 'payload_too_large',
      code: 'payload_too_large',
      limitBytes: PAYLOAD_LIMIT_BYTES,
      estimatedBytes,
      hint: PAYLOAD_TOO_LARGE_HINT,
    });
    return true;
  }
  return false;
}

const baseHandler = createApiHandler({
  methods: 'POST',
  rateLimitKey: 'publish-product',
  context: 'publish-product',
  requiredEnv: resolveEnvRequirements('SHOPIFY_ADMIN', 'SUPABASE_SERVICE'),
  handler: publishProduct,
});

export default async function publishProductRoute(req, res) {
  const method = String(req?.method || '').toUpperCase();

  if (method === 'OPTIONS') {
    handleOptions(req, res);
    return;
  }

  if (method === 'POST' && enforcePayloadLimit(req, res)) {
    return;
  }

  return baseHandler(req, res);
}

export const config = {
  runtime: 'nodejs',
  api: {
    bodyParser: true,
    sizeLimit: '20mb',
  },
};
