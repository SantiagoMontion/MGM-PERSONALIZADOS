import logger from './logger';

const RAW_API_URL = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL : '';
const USE_PROXY = (import.meta.env.VITE_USE_PROXY || '').trim() === '1';
const IS_DEV = Boolean(import.meta.env && import.meta.env.DEV);

function sanitizeBase(value) {
  if (!value) return '';
  return value.trim().replace(/\/+$/, '');
}

function applyProtocol(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }
  return `https://${value}`;
}

function resolveBaseOrigin(value) {
  const trimmed = sanitizeBase(value);
  if (!trimmed) return '';
  const withoutApi = trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
  return sanitizeBase(applyProtocol(withoutApi));
}

const CONFIGURED_ORIGIN = resolveBaseOrigin(RAW_API_URL);
const DEFAULT_BASE = '/api';
let hasWarnedAboutFallback = false;

function normalizePath(path) {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function resolveRequestUrl(path) {
  const normalizedPath = normalizePath(path);
  if (IS_DEV && USE_PROXY) {
    return normalizedPath;
  }
  if (!CONFIGURED_ORIGIN) {
    if (!hasWarnedAboutFallback) {
      hasWarnedAboutFallback = true;
      try {
        logger.warn?.('[api] using_default_base', {
          message: 'VITE_API_URL not set; defaulting to same-origin /api.',
        });
      } catch {}
    }
    return `${DEFAULT_BASE}${normalizedPath}`;
  }
  return `${CONFIGURED_ORIGIN}${normalizedPath}`;
}

export function apiFetch(methodOrPath, maybePathOrInit, maybeBody, maybeInitOverrides) {
  if (typeof maybePathOrInit === 'string') {
    const method = typeof methodOrPath === 'string' ? methodOrPath.toUpperCase() : '';
    if (!method) {
      throw new Error('apiFetch(method, path, body) requires an HTTP method');
    }
    const path = maybePathOrInit;
    const overrides = maybeInitOverrides && typeof maybeInitOverrides === 'object'
      ? { ...maybeInitOverrides }
      : {};
    const headers = {
      Accept: 'application/json',
      ...(overrides.headers || {}),
    };
    let bodyToSend = maybeBody;
    const isFormData = typeof FormData !== 'undefined' && bodyToSend instanceof FormData;
    const isBlob = typeof Blob !== 'undefined' && bodyToSend instanceof Blob;
    const isUrlSearchParams = typeof URLSearchParams !== 'undefined' && bodyToSend instanceof URLSearchParams;
    if (!isFormData && !isBlob && !isUrlSearchParams && bodyToSend != null && typeof bodyToSend !== 'string') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json; charset=utf-8';
      bodyToSend = JSON.stringify(bodyToSend);
    }
    if (bodyToSend == null) {
      delete overrides.body;
    } else {
      overrides.body = bodyToSend;
    }
    overrides.method = method;
    overrides.headers = headers;
    return fetch(resolveRequestUrl(path), overrides);
  }
  const url = resolveRequestUrl(methodOrPath);
  return fetch(url, maybePathOrInit);
}

export function getApiBaseUrl() {
  if (IS_DEV && USE_PROXY) {
    return '/api';
  }
  if (!CONFIGURED_ORIGIN) {
    return DEFAULT_BASE;
  }
  return `${CONFIGURED_ORIGIN}/api`;
}

export function getResolvedApiUrl(path) {
  return resolveRequestUrl(path);
}
