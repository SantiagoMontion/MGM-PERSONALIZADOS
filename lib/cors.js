import { randomUUID } from 'crypto';
import logger from './_lib/logger.js';

export const BASE_ALLOW_HEADERS = [
  'content-type',
  'authorization',
  'x-requested-with',
  'x-admin-token',
  'x-preview',
  'x-diag',
  'x-file-name',
  'x-debug',
  'x-debug-fast',
  'x-rid',
  'cache-control',
  'pragma',
];

export const SAFE_HEADER_REGEX = /^[a-z0-9-]+$/;

const ACCESS_CONTROL_MAX_AGE = '86400';
const ALLOW_METHODS = 'GET, POST, OPTIONS';
const DEFAULT_FRONT_ORIGIN = 'https://mgm-app.vercel.app';
const STATIC_ALLOWED = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://mgmgamers.store',
  'https://www.mgmgamers.store',
  'https://tu-mousepad-personalizado.mgmgamers.store',
  'https://mgm-api.vercel.app',
];
const STATIC_SUFFIXES = ['.vercel.app', '.mgmgamers.store'];

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function sanitizeOrigin(value) {
  if (typeof value !== 'string') return null;
  let trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed.replace(/^\/+/, '')}`;
  }
  try {
    const url = new URL(trimmed);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.host.toLowerCase();
    const protocol = url.protocol.toLowerCase();
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

export function normalizeOrigin(value) {
  const sanitized = sanitizeOrigin(value);
  return sanitized ? sanitized.toLowerCase() : null;
}

function getAllowedOriginSuffixes() {
  const suffixes = new Set();
  for (const suffix of STATIC_SUFFIXES) {
    if (typeof suffix === 'string' && suffix.trim()) {
      suffixes.add(suffix.trim().toLowerCase());
    }
  }
  for (const entry of toArray(process.env.ALLOWED_ORIGIN_SUFFIXES)) {
    suffixes.add(entry.toLowerCase());
  }
  return suffixes;
}

function isSuffixAllowed(origin) {
  try {
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol)) {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    for (const suffix of getAllowedOriginSuffixes()) {
      if (hostname === suffix || hostname.endsWith(suffix)) {
        return true;
      }
    }
    return false;
  } catch (err) {
    logger.warn?.('[cors] invalid_origin', { origin, error: err?.message || err });
    return false;
  }
}

function isLocalhost(normalizedOrigin) {
  if (!normalizedOrigin) return false;
  return (
    normalizedOrigin.startsWith('http://localhost') || normalizedOrigin.startsWith('http://127.0.0.1')
  );
}

function getApiOriginFromEnv() {
  const host = process.env?.VERCEL_URL;
  if (host && /^[-a-z0-9.]+$/i.test(host)) {
    const sanitized = sanitizeOrigin(`https://${host}`);
    if (sanitized) return sanitized;
  }
  if (process.env?.API_PUBLIC_ORIGIN) {
    const sanitized = sanitizeOrigin(process.env.API_PUBLIC_ORIGIN);
    if (sanitized) return sanitized;
  }
  return null;
}

function createAllowMap(allowList) {
  const allowMap = new Map();

  const add = (origin) => {
    const sanitized = sanitizeOrigin(origin);
    const normalized = normalizeOrigin(origin);
    if (sanitized && normalized) {
      allowMap.set(normalized, sanitized);
    }
  };

  const frontOrigin = sanitizeOrigin(process.env.FRONT_ORIGIN) || sanitizeOrigin(DEFAULT_FRONT_ORIGIN);
  if (frontOrigin) {
    add(frontOrigin);
  }

  for (const entry of STATIC_ALLOWED) {
    add(entry);
  }

  for (const entry of toArray(process.env.ALLOWED_ORIGINS)) {
    add(entry);
  }

  if (Array.isArray(allowList)) {
    for (const entry of allowList) {
      add(entry);
    }
  }

  const apiOrigin = getApiOriginFromEnv();
  if (apiOrigin) {
    add(apiOrigin);
  }

  return allowMap;
}

export function getAllowedOriginsFromEnv() {
  return Array.from(createAllowMap([]).values());
}

export function resolveCorsDecision(originHeader, allowList) {
  const requestedOrigin = sanitizeOrigin(originHeader);
  const normalizedOrigin = normalizeOrigin(originHeader);
  const allowMap = createAllowMap(allowList);

  if (normalizedOrigin && allowMap.has(normalizedOrigin)) {
    return {
      requestedOrigin,
      normalizedOrigin,
      allowedOrigin: allowMap.get(normalizedOrigin) ?? null,
      allowed: true,
    };
  }

  if (requestedOrigin && isSuffixAllowed(requestedOrigin)) {
    return {
      requestedOrigin,
      normalizedOrigin,
      allowedOrigin: requestedOrigin,
      allowed: true,
    };
  }

  if (isLocalhost(normalizedOrigin)) {
    return {
      requestedOrigin,
      normalizedOrigin,
      allowedOrigin: requestedOrigin,
      allowed: true,
    };
  }

  return {
    requestedOrigin,
    normalizedOrigin,
    allowedOrigin: null,
    allowed: false,
  };
}

function normalizeHeaderValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !SAFE_HEADER_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function buildAllowHeaders(req, baseHeaders = BASE_ALLOW_HEADERS) {
  const seen = new Set();
  const allowHeaders = [];

  const push = (value) => {
    const normalized = normalizeHeaderValue(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    allowHeaders.push(normalized);
  };

  for (const header of baseHeaders) {
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

function getOriginHeader(req) {
  const header = req?.headers?.origin;
  if (Array.isArray(header)) {
    return header.find((value) => typeof value === 'string' && value.trim().length > 0);
  }
  return typeof header === 'string' ? header : undefined;
}

export function resolveRequestCors(req, allowList) {
  const originHeader = getOriginHeader(req);
  const decision = resolveCorsDecision(originHeader, allowList);
  return {
    ...decision,
    allowHeaders: buildAllowHeaders(req),
  };
}

export function applyCorsHeaders(req, res, decision) {
  const resolved = decision || resolveRequestCors(req);
  const allowHeaders = resolved.allowHeaders || buildAllowHeaders(req);

  if (resolved.allowed && resolved.allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', resolved.allowedOrigin);
  }

  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', allowHeaders);
  res.setHeader('Access-Control-Max-Age', ACCESS_CONTROL_MAX_AGE);

  return { ...resolved, allowHeaders };
}

export function ensureCors(req, res, allowList) {
  const decision = resolveRequestCors(req, allowList);
  return applyCorsHeaders(req, res, decision);
}

export function handlePreflight(req, res, decision) {
  const resolved = applyCorsHeaders(req, res, decision);
  if (typeof res.status === 'function') {
    res.status(204);
  } else {
    res.statusCode = 204;
  }
  res.end();
  return resolved;
}

export function respondCorsDenied(req, res, decision, diagId) {
  applyCorsHeaders(req, res, decision);
  if (typeof res.status === 'function') {
    res.status(403);
  } else {
    res.statusCode = 403;
  }
  try {
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  } catch {}
  res.end(JSON.stringify({ ok: false, error: 'origin_not_allowed', diagId }));
}

export function withCors(handler) {
  return async (req, res) => {
    const decision = ensureCors(req, res);

    if (!decision.allowed || !decision.allowedOrigin) {
      const diagId = randomUUID();
      try {
        logger.warn?.('[cors] denied', {
          diagId,
          origin: decision.requestedOrigin,
          method: req?.method,
          url: req?.url,
        });
      } catch {}
      respondCorsDenied(req, res, decision, diagId);
      return;
    }

    if (String(req.method || '').toUpperCase() === 'OPTIONS') {
      handlePreflight(req, res, decision);
      return;
    }

    return handler(req, res);
  };
}

export default {
  withCors,
  applyCorsHeaders,
  ensureCors,
  resolveCorsDecision,
  getAllowedOriginsFromEnv,
  respondCorsDenied,
  handlePreflight,
  resolveRequestCors,
};
