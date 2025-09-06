const API_URL = import.meta.env.VITE_API_URL || '';
const USE_PROXY = (import.meta.env.VITE_USE_PROXY || '').trim() === '1';

export function apiFetch(path: string, init?: RequestInit) {
  const p = path.startsWith('/') ? path : '/' + path;
  if (import.meta.env.DEV && USE_PROXY) {
    // Use Vite proxy in dev to avoid CORS issues
    return fetch(p, init);
  }
  const url = `${API_URL}${p}`;
  return fetch(url, init);
}
