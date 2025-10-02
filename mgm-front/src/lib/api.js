import logger from './logger';
const RAW_API_URL = typeof import.meta.env.VITE_API_URL === 'string'
  ? import.meta.env.VITE_API_URL
  : '';
const CLEAN_API_URL = RAW_API_URL.trim().replace(/[/]+$/, '');
const API_ORIGIN = CLEAN_API_URL.endsWith('/api')
  ? CLEAN_API_URL.slice(0, -4)
  : CLEAN_API_URL;
const USE_PROXY = (import.meta.env.VITE_USE_PROXY || '').trim() === '1';
const IS_DEV = Boolean(import.meta.env && import.meta.env.DEV);

let hasWarnedAboutMissingApiUrl = false;

function normalizePath(path) {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function resolveRequestUrl(path) {
  const normalizedPath = normalizePath(path);
  if (IS_DEV && USE_PROXY) {
    return normalizedPath;
  }
  if (!API_ORIGIN) {
    if (!hasWarnedAboutMissingApiUrl) {
      hasWarnedAboutMissingApiUrl = true;
      try {
        logger.error('[api] missing_api_url', {
          message: 'VITE_API_URL is not configured. Requests will fail.',
          path: normalizedPath,
        });
      } catch (loggingErr) {
        if (loggingErr) {
          // noop
        }
      }
    }
    const error = new Error('VITE_API_URL is not configured');
    error.code = 'missing_api_url';
    throw error;
  }
  return `${API_ORIGIN}${normalizedPath}`;
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
  if (!API_ORIGIN) {
    return '';
  }
  return `${API_ORIGIN}/api`;
}

export function getResolvedApiUrl(path) {
  try {
    return resolveRequestUrl(path);
  } catch (err) {
    if (err && err.code === 'missing_api_url') {
      return '';
    }
    throw err;
  }
}