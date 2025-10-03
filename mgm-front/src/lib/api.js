import logger from './logger';

const RAW_API_URL = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL : '';
const USE_PROXY = (import.meta.env.VITE_USE_PROXY || '').trim() === '1';
const IS_DEV = Boolean(import.meta.env && import.meta.env.DEV);

function sanitize(value) {
  if (!value) return '';
  return value.trim().replace(/\/+$/, '');
}

function ensureProtocol(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }
  return `https://${value}`;
}

function resolveOrigin(value) {
  const trimmed = sanitize(value);
  if (!trimmed) return '';
  const withoutApi = trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
  return sanitize(ensureProtocol(withoutApi));
}

const CONFIGURED_ORIGIN = resolveOrigin(RAW_API_URL);
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
          message: 'VITE_API_URL not set; defaulting to same-origin.',
        });
      } catch {}
    }
    return normalizedPath;
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

export async function postJSON(url, data, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data ?? {}),
      signal: ctrl.signal,
    });

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }

    if (!res.ok) {
      const message = typeof json?.error === 'string' && json.error ? json.error : text;
      const formatted = `HTTP ${res.status}${message ? ` ${message}` : ''}`.trim();
      throw new Error(formatted);
    }
    return json ?? { ok: true };
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'DOMException') {
      throw new Error('TIMEOUT: la solicitud tardó demasiado (>60s)');
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

export function getApiBaseUrl() {
  if (IS_DEV && USE_PROXY) {
    return '/api';
  }
  if (!CONFIGURED_ORIGIN) {
    return '/api';
  }
  return `${CONFIGURED_ORIGIN}/api`;
}

export function getResolvedApiUrl(path) {
  return resolveRequestUrl(path);
}
