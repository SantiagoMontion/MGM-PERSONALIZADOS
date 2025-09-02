// /lib/shopify.js
// Requiere: "type": "module" en package.json y Node 18+ (fetch nativo)
import { randomUUID } from "crypto";

/**
 * shopifyAdmin
 * Llama a la Admin API de Shopify con Idempotency-Key automático (o el que pases).
 *
 * @param {string} path - ej: "/draft_orders.json"
 * @param {RequestInit} init - { method, body, headers }
 * @param {string} [idemKey] - opcional, si querés controlar la idempotencia
 */
export async function shopifyAdmin(path, init = {}, idemKey) {
  const base = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
    "X-Shopify-Idempotency-Key": idemKey || randomUUID(), // 👈 clave única por request
    ...(init.headers || {}),
  };

  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    /* no-op */
  }

  if (!res.ok) {
    const err = new Error(`shopify ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return json;
}

/**
 * shopifyAdminGraphQL
 * Realiza una consulta GraphQL contra la Admin API de Shopify.
 *
 * @param {string} query - Consulta GraphQL
 * @param {object} variables - Variables para la consulta
 * @param {string} [idemKey] - opcional, para controlar la idempotencia
 */
export async function shopifyAdminGraphQL(query, variables = {}, idemKey) {
  const base = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
    "X-Shopify-Idempotency-Key": idemKey || randomUUID(),
  };

  const res = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    /* no-op */
  }

  if (!res.ok) {
    const err = new Error(`shopify ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return json;
}
