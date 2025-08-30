const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export async function searchJobs(token, params = {}) {
  const url = new URL(`${API_BASE}/api/admin/search-jobs`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}
