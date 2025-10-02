const RAW_API_URL = typeof import.meta.env.VITE_API_URL === 'string'
  ? import.meta.env.VITE_API_URL
  : '';
const CLEAN_API_URL = RAW_API_URL.trim().replace(/[/]+$/, '');
const API_ORIGIN = CLEAN_API_URL.endsWith('/api')
  ? CLEAN_API_URL.slice(0, -4)
  : CLEAN_API_URL;
const USE_PROXY = (import.meta.env.VITE_USE_PROXY || '').trim() === '1';
const IS_DEV = Boolean(import.meta.env && import.meta.env.DEV);
const API_BASE_PATH = '/api';

function normalizePath(path) {
  const ensured = path ? (path.startsWith('/') ? path : `/${path}`) : '/';
  if (ensured === API_BASE_PATH) {
    return API_BASE_PATH;
  }
  if (ensured.startsWith(`${API_BASE_PATH}/`)) {
    return ensured;
  }
  const trimmed = ensured.replace(/^\/+/, '');
  if (!trimmed) {
    return API_BASE_PATH;
  }
  return `${API_BASE_PATH}/${trimmed}`;
}

function resolveRequestUrl(path) {
  const normalizedPath = normalizePath(path);
  if (!API_ORIGIN || (IS_DEV && USE_PROXY)) {
    return normalizedPath;
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
  if (!API_ORIGIN || (IS_DEV && USE_PROXY)) {
    return API_BASE_PATH;
  }
  return `${API_ORIGIN}${API_BASE_PATH}`;
}

export function getResolvedApiUrl(path) {
  return resolveRequestUrl(path);
}
