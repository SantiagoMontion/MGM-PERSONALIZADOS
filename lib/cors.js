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

function applyCors(res, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
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
    if (req.method === 'OPTIONS') {
      applyCors(res, origin);
      res.statusCode = 204;
      return res.end();
    }
    applyCors(res, origin);
    return handler(req, res);
  };
}
