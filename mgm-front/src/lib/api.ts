const RAW_API_URL = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL : '';
const API_URL = RAW_API_URL.trim().replace(/\/+$, '');
const API_ORIGIN = API_URL.endsWith('/api') ? API_URL.slice(0, -4) : API_URL;
const USE_PROXY = (import.meta.env.VITE_USE_PROXY || '').trim() === '1';

export function apiFetch(path: string, init?: RequestInit) {
  const p = path.startsWith('/') ? path : '/' + path;
  if (import.meta.env.DEV && USE_PROXY) {
    // Use Vite proxy in dev to avoid CORS issues
    return fetch(p, init);
  }
  const base = API_ORIGIN;
  const url = base ? `${base}${p}` : p;
  return fetch(url, init);
}
