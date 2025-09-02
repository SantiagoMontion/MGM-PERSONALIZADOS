const rawBase = import.meta.env.VITE_API_BASE;
if (!rawBase) throw new Error("VITE_API_BASE missing");
const BASE = rawBase.replace(/\/$/, "");

export async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    /* ignore */
  }
  if (!res.ok) {
    const err = new Error(`API ${res.status}`);
    err.body = json || text;
    throw err;
  }
  return json;
}
