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

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function resolveRequestUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  if (IS_DEV && USE_PROXY) {
    return normalizedPath;
  }
  if (!API_ORIGIN) {
    if (!hasWarnedAboutMissingApiUrl) {
      hasWarnedAboutMissingApiUrl = true;
      try {
        console.error('[api] missing_api_url', {
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
    (error as Error & { code?: string }).code = 'missing_api_url';
    throw error;
  }
  return `${API_ORIGIN}${normalizedPath}`;
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
  if (!API_ORIGIN) {
    return '';
  }
  return `${API_ORIGIN}/api`;
}

export function getResolvedApiUrl(path: string): string {
  try {
    return resolveRequestUrl(path);
  } catch (err) {
    if ((err as Error & { code?: string })?.code === 'missing_api_url') {
      return '';
    }
    throw err;
  }
}
