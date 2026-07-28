#!/usr/bin/env node
/**
 * Asigna templateSuffix de tema Shopify según el título del producto.
 *
 *   PRO      → serie-pro
 *   Classic  → serie-classic
 *   Ultra    → serie-ultra
 *   Glasspad → serie-g-glasspad
 *   Alfombra → alfombras
 *   (sin señal en título) → producto predeterminado (templateSuffix vacío)
 *
 * Uso:
 *   node scripts/shopify-assign-theme-templates.mjs           # dry-run
 *   node scripts/shopify-assign-theme-templates.mjs --apply   # escribe en Shopify
 *
 * Requiere: SHOPIFY_STORE_DOMAIN (o SHOPIFY_SHOP), SHOPIFY_ADMIN_TOKEN, SHOPIFY_API_VERSION
 */
import { randomUUID } from 'node:crypto';
import { shopifyAdminGraphQL } from '../lib/shopify.js';
import { resolveThemeTemplateSuffixFromTitle } from '../lib/shopify/themeTemplateSuffix.js';

try {
  await import('dotenv/config');
} catch {
  // optional
}

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 50;
const APPLY_DELAY_MS = 40;
const APPLY_RETRIES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSuffix(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

const PRODUCTS_QUERY = `query ThemeTemplateProducts($cursor: String) {
  products(first: ${PAGE_SIZE}, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      templateSuffix
    }
  }
}`;

const PRODUCT_UPDATE_MUTATION = `mutation ProductTemplateUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id title templateSuffix }
    userErrors { field message }
  }
}`;

async function fetchAllProducts() {
  const products = [];
  let cursor = null;
  let page = 0;
  while (true) {
    page += 1;
    let resp;
    let json;
    for (let attempt = 1; attempt <= APPLY_RETRIES; attempt += 1) {
      try {
        resp = await shopifyAdminGraphQL(PRODUCTS_QUERY, { cursor }, randomUUID());
        json = await resp.json();
        break;
      } catch (err) {
        if (attempt >= APPLY_RETRIES) throw err;
        console.warn(`\nReintento listado ${attempt}/${APPLY_RETRIES}: ${err?.message ?? err}`);
        await sleep(APPLY_DELAY_MS * attempt * 3);
      }
    }
    if (!resp.ok || json?.errors?.length) {
      throw new Error(`GraphQL products query failed: ${JSON.stringify(json?.errors ?? json).slice(0, 500)}`);
    }
    const batch = json?.data?.products;
    if (!batch) throw new Error('GraphQL products query: respuesta vacía');
    const nodes = Array.isArray(batch.nodes) ? batch.nodes : [];
    products.push(...nodes);
    process.stdout.write(`\rListados ${products.length} productos (pág. ${page})…`);
    if (!batch.pageInfo?.hasNextPage) break;
    cursor = batch.pageInfo.endCursor;
    if (APPLY_DELAY_MS > 0) await sleep(50);
  }
  process.stdout.write('\n');
  return products;
}

function planUpdates(products) {
  const updates = [];
  const unchanged = [];
  const counts = {
    'serie-pro': 0,
    'serie-classic': 0,
    'serie-ultra': 0,
    'serie-g-glasspad': 0,
    alfombras: 0,
    default: 0,
  };

  for (const product of products) {
    const desired = resolveThemeTemplateSuffixFromTitle(product?.title);
    const current = normalizeSuffix(product?.templateSuffix);
    const key = desired || 'default';
    counts[key] = (counts[key] || 0) + 1;

    if (current === desired) {
      unchanged.push({
        id: product.id,
        title: product.title,
        templateSuffix: current,
      });
      continue;
    }

    updates.push({
      id: product.id,
      title: product.title,
      from: current,
      to: desired,
    });
  }

  return { updates, unchanged, counts };
}

async function applyUpdates(updates) {
  let applied = 0;
  let errors = 0;

  for (const row of updates) {
    let resp;
    let json;
    for (let attempt = 1; attempt <= APPLY_RETRIES; attempt += 1) {
      try {
        resp = await shopifyAdminGraphQL(
          PRODUCT_UPDATE_MUTATION,
          {
            input: {
              id: row.id,
              // string vacía = plantilla producto predeterminada
              templateSuffix: row.to ?? '',
            },
          },
          randomUUID(),
        );
        json = await resp.json();
        break;
      } catch (err) {
        if (attempt >= APPLY_RETRIES) throw err;
        console.warn(`Reintento ${attempt}/${APPLY_RETRIES} en ${row.id}: ${err?.message ?? err}`);
        await sleep(APPLY_DELAY_MS * attempt * 2);
      }
    }

    if (APPLY_DELAY_MS > 0) await sleep(APPLY_DELAY_MS);

    const userErrors = json?.data?.productUpdate?.userErrors ?? [];
    if (userErrors.length || !resp.ok || json?.errors?.length) {
      errors += 1;
      console.error('ERROR', row.id, row.title?.slice(0, 60), userErrors, json?.errors);
      continue;
    }

    applied += 1;
    console.log(
      `OK ${String(row.from ?? '(default)').padEnd(18)} → ${String(row.to ?? '(default)').padEnd(18)}`
      + ` | ${String(row.title || '').slice(0, 70)}`,
    );
  }

  return { applied, errors };
}

async function main() {
  console.log(APPLY ? 'MODO APPLY (escribe en Shopify)' : 'MODO DRY-RUN (solo preview)');
  const products = await fetchAllProducts();
  const { updates, unchanged, counts } = planUpdates(products);

  console.log(`\nProductos escaneados: ${products.length}`);
  console.log(`A actualizar: ${updates.length}`);
  console.log(`Sin cambio: ${unchanged.length}`);
  console.log('\nDistribución por plantilla (según título):');
  for (const [key, n] of Object.entries(counts)) {
    console.log(`  ${key}: ${n}`);
  }

  if (updates.length) {
    console.log('\nPreview (primeras 30):');
    for (const row of updates.slice(0, 30)) {
      console.log(
        `  ${String(row.from ?? '(default)').padEnd(18)} → ${String(row.to ?? '(default)').padEnd(18)}`
        + ` | ${String(row.title || '').slice(0, 70)}`,
      );
    }
    if (updates.length > 30) console.log(`  … y ${updates.length - 30} más`);
  }

  if (!APPLY) {
    console.log('\nPara aplicar: node scripts/shopify-assign-theme-templates.mjs --apply');
    return;
  }

  const { applied, errors } = await applyUpdates(updates);
  console.log(`\nListo: ${applied} productos actualizados, ${errors} errores.`);
  if (errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
