const API_URL = import.meta.env.VITE_API_URL || '';
export function apiFetch(path, init) {
  const url = `${API_URL}${path.startsWith('/') ? path : '/' + path}`;
  return fetch(url, init);
}

