import logger from './_lib/logger.js';

const STATIC_ALLOWED = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://mgmgamers.store',
  'https://www.mgmgamers.store',
  'https://tu-mousepad-personalizado.mgmgamers.store',
  'https://mgm-api.vercel.app',
];

const SUFFIX_ALLOWED = new Set(['.vercel.app', '.mgmgamers.store']);

if (process.env?.ALLOWED_ORIGIN_SUFFIXES) {
  for (const entry of process.env.ALLOWED_ORIGIN_SUFFIXES.split(',')) {
    if (entry && entry.trim()) {
      SUFFIX_ALLOWED.add(entry.trim());
    }
  }
}

const DEFAULT_FALLBACK_ORIGIN = 'https://www.mgmgamers.store';
const ACCESS_CONTROL_MAX_AGE = '86400';
const ALLOW_METHODS = 'GET, POST, OPTIONS';
const BASE_ALLOW_HEADERS = [
  'content-type',
  'authorization',
  'x-preview',
  'x-debug',
  'x-requested-with',
  'x-admin-token',
  'x-rid',
  'cache-control',
  'pragma',
];
const SAFE_HEADER_REGEX = /^[a-z0-9-]+$/;

function normalizeOrigin(origin) {
  if (!origin) return null;
  let normalized = String(origin).trim();
  if (!normalized) return null;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized.replace(/^\/+/, '')}`;
  }
  normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

const ALLOWED = new Set();
function addAllowed(origin) {
  const normalized = normalizeOrigin(origin);
  if (normalized) {
    ALLOWED.add(normalized);
  }
}

STATIC_ALLOWED.forEach(addAllowed);

if (typeof process !== 'undefined' && process.env && process.env.ALLOWED_ORIGINS) {
  const extra = process.env.ALLOWED_ORIGINS.split(',');
  for (const entry of extra) {
    if (entry && entry.trim()) addAllowed(entry.trim());
  }
}

const FALLBACK_ORIGIN = normalizeOrigin(DEFAULT_FALLBACK_ORIGIN);

function getApiOriginFromEnv() {
  const host = process.env?.VERCEL_URL;
  if (host && /^[-a-z0-9.]+$/.test(host)) return normalizeOrigin(`https://${host}`);
  if (process.env?.API_PUBLIC_ORIGIN) return normalizeOrigin(process.env.API_PUBLIC_ORIGIN);
  return null;
}

function pickOrigin(req) {
  const requestOrigin = normalizeOrigin(req.headers?.origin || '');
  const apiOrigin = getApiOriginFromEnv();
  if (apiOrigin) addAllowed(apiOrigin);
  if (requestOrigin && (ALLOWED.has(requestOrigin) || isSuffixAllowed(requestOrigin))) {
    return requestOrigin;
  }
  return FALLBACK_ORIGIN;
}

function isSuffixAllowed(origin) {
  try {
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol)) {
      return false;
    }
    for (const suffix of SUFFIX_ALLOWED) {
      if (url.hostname === suffix || url.hostname.endsWith(suffix)) {
        return true;
      }
    }
    return false;
  } catch (err) {
    logger.warn?.('[CORS] invalid_origin', { origin, err: err?.message || err });
    return false;
  }
}

function normalizeHeaderValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !SAFE_HEADER_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function buildAllowHeaders(req) {
  const seen = new Set();
  const allowHeaders = [];

  const push = (value) => {
    const normalized = normalizeHeaderValue(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    allowHeaders.push(normalized);
  };

  for (const header of BASE_ALLOW_HEADERS) {
    push(header);
  }

  const requested = req?.headers?.['access-control-request-headers'];
  if (typeof requested === 'string') {
    for (const segment of requested.split(',')) {
      push(segment);
    }
  } else if (Array.isArray(requested)) {
    for (const value of requested) {
      push(value);
    }
  }

  return allowHeaders.join(', ');
}

export function applyCorsHeaders(req, res, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', buildAllowHeaders(req));
  res.setHeader('Access-Control-Max-Age', ACCESS_CONTROL_MAX_AGE);
}

export function withCors(handler) {
  return async (req, res) => {
    try {
      const o = req.headers?.origin || '';
      if (process.env?.DEBUG_CORS === '1') {
        logger.debug('[CORS]', { method: req.method, origin: o, url: req.url });
      }
    } catch {}
    const origin = pickOrigin(req);
    if (String(req.method || '').toUpperCase() === 'OPTIONS') {
      applyCorsHeaders(req, res, origin);
      res.statusCode = 204;
      return res.end();
    }
    applyCorsHeaders(req, res, origin);
    return handler(req, res);
  };
}

