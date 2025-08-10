export async function shopifyAdmin(path, init = {}) {
  const base = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
    // 👇 Agregamos clave única por request
    'X-Shopify-Idempotency-Key': crypto.randomUUID(),
    ...(init.headers || {})
  };
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`shopify ${res.status}: ${text || res.statusText}`);
  return json;
}
