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

export function apiFetch(path: string, init?: RequestInit) {
  const url = resolveRequestUrl(path);
  return fetch(url, init);
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
