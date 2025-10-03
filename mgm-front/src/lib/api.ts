import logger from './logger';

const RAW_API_URL = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL : '';
const USE_PROXY = (import.meta.env.VITE_USE_PROXY || '').trim() === '1';
const IS_DEV = Boolean(import.meta.env && import.meta.env.DEV);

function sanitizeBase(value: string): string {
  if (!value) return '';
  return value.trim().replace(/\/+$/, '');
}

function ensureAbsoluteBase(value: string): string {
  const trimmed = sanitizeBase(value);
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  if (trimmed.startsWith('/')) {
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  const withProtocol = `https://${trimmed}`;
  return withProtocol.endsWith('/api') ? withProtocol : `${withProtocol}/api`;
}

const CONFIGURED_BASE = ensureAbsoluteBase(RAW_API_URL);
const API_BASE = CONFIGURED_BASE || '/api';

let hasWarnedAboutFallback = false;

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function resolveRequestUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  if (IS_DEV && USE_PROXY) {
    return normalizedPath;
  }
  if (!CONFIGURED_BASE && !hasWarnedAboutFallback) {
    hasWarnedAboutFallback = true;
    try {
      logger.warn?.('[api] using_default_base', {
        message: 'VITE_API_URL not set; defaulting to same-origin /api.',
      });
    } catch {}
  }
  return `${API_BASE}${normalizedPath}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response>;
export function apiFetch(method: string, path: string, body?: unknown, initOverrides?: RequestInit): Promise<Response>;
export function apiFetch(
  methodOrPath: string,
  maybePathOrInit?: string | RequestInit,
  maybeBody?: unknown,
  maybeInitOverrides?: RequestInit,
): Promise<Response> {
  if (typeof maybePathOrInit === 'string') {
    const method = typeof methodOrPath === 'string' ? methodOrPath.toUpperCase() : '';
    if (!method) {
      throw new Error('apiFetch(method, path, body) requires an HTTP method');
    }
    const path = maybePathOrInit;
    const overrides: RequestInit = maybeInitOverrides && typeof maybeInitOverrides === 'object'
      ? { ...maybeInitOverrides }
      : {};
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (overrides.headers) {
      if (typeof Headers !== 'undefined' && overrides.headers instanceof Headers) {
        overrides.headers.forEach((value, key) => { headers[key] = value; });
      } else if (Array.isArray(overrides.headers)) {
        for (const [key, value] of overrides.headers) {
          headers[key] = value as string;
        }
      } else {
        Object.assign(headers, overrides.headers as Record<string, string>);
      }
    }
    let bodyToSend = maybeBody as BodyInit | undefined;
    const isFormData = typeof FormData !== 'undefined' && maybeBody instanceof FormData;
    const isBlob = typeof Blob !== 'undefined' && maybeBody instanceof Blob;
    const isUrlSearchParams = typeof URLSearchParams !== 'undefined' && maybeBody instanceof URLSearchParams;
    if (!isFormData && !isBlob && !isUrlSearchParams && bodyToSend != null && typeof bodyToSend !== 'string') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json; charset=utf-8';
      bodyToSend = JSON.stringify(maybeBody ?? null);
    }
    if (bodyToSend == null) {
      delete (overrides as Record<string, unknown>).body;
    } else {
      (overrides as Record<string, unknown>).body = bodyToSend;
    }
    overrides.method = method;
    overrides.headers = headers;
    return fetch(resolveRequestUrl(path), overrides);
  }
  const url = resolveRequestUrl(methodOrPath);
  return fetch(url, maybePathOrInit);
}

export function getApiBaseUrl(): string {
  if (IS_DEV && USE_PROXY) {
    return '/api';
  }
  return API_BASE;
}

export function getResolvedApiUrl(path: string): string {
  return resolveRequestUrl(path);
}
