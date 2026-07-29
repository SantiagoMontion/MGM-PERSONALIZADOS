#!/usr/bin/env node
/**
 * Arregla productos con "Form" en el título:
 * - precio variantes = 12000
 * - quita MGM / MGMGAMERS del título (y tags si aparecen)
 *
 * Uso:
 *   node scripts/shopify-fix-form-products.mjs
 *   node scripts/shopify-fix-form-products.mjs --apply
 */
import { randomUUID } from 'node:crypto';
import { shopifyAdminGraphQL } from '../lib/shopify.js';

try {
  await import('dotenv/config');
} catch {
  // optional
}

const APPLY = process.argv.includes('--apply');
const TARGET_PRICE = '12000.00';
const PAGE = 50;

const PRODUCTS_QUERY = `query FormProducts($cursor: String) {
  products(first: ${PAGE}, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      tags
      descriptionHtml
      variants(first: 50) {
        nodes { id title price compareAtPrice sku }
      }
    }
  }
}`;

const PRODUCT_UPDATE = `mutation ProductUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id title tags }
    userErrors { field message }
  }
}`;

const VARIANTS_UPDATE = `mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id price }
    userErrors { field message }
  }
}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isFormProduct(title) {
  const t = String(title || '');
  // Form circular real: medida + (opcional material) + Form, o Form + material
  // Evita diseños tipo "Form Tiger", "Asta Black Form 82x32", etc.
  if (/\d+\s*[x×]\s*\d+\s*(?:cm)?\s+(?:(?:classic|pro|alfombra)\s+)?form(?:\s+(?:classic|pro))?\b/i.test(t)) {
    return true;
  }
  if (/\balfombra\s+form\b/i.test(t)) return true;
  return false;
}

/** Precio fijo $12000 solo para mousepads Form (no alfombras). */
function shouldForceFormPrice(title) {
  const t = String(title || '').trim();
  if (!isFormProduct(t)) return false;
  if (/^alfombra\b/i.test(t) || /\balfombra\s+form\b/i.test(t)) return false;
  return true;
}

function scrubMgmText(value) {
  return String(value || '')
    .replace(/\bmgmgamers\b/gi, '')
    .replace(/\bmgm[-\s]?gamers?\b/gi, '')
    .replace(/\bmgm\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/^\s*[|\-]\s*|\s*[|\-]\s*$/g, '')
    .trim();
}

function scrubMgmTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const out = [];
  for (const raw of list) {
    const tag = String(raw || '').trim();
    if (!tag) continue;
    // No tocar fingerprints internos (mgm_fp:...)
    if (/^mgm_fp:/i.test(tag)) {
      out.push(tag);
      continue;
    }
    if (/^(mgm|mgmgamers|mgm-gamers?|mgm gamers?)$/i.test(tag)) continue;
    const scrubbed = scrubMgmText(tag);
    if (scrubbed) out.push(scrubbed);
  }
  return out;
}

function scrubMgmSku(sku) {
  const raw = String(sku || '').trim();
  if (!raw) return raw;
  return raw
    .replace(/^MGMGAMERS[-_]?/i, '')
    .replace(/^MGM[-_]?/i, '')
    .replace(/[-_]?MGMGAMERS\b/gi, '')
    .replace(/[-_]?MGM\b/gi, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
}

function needsPriceFix(variants) {
  return (variants || []).some((v) => {
    const n = Number.parseFloat(String(v.price || '').replace(',', '.'));
    return !Number.isFinite(n) || Math.round(n) !== 12000;
  });
}

async function fetchAllProducts() {
  const products = [];
  let cursor = null;
  let page = 0;
  while (true) {
    page += 1;
    let resp;
    let json;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        resp = await shopifyAdminGraphQL(PRODUCTS_QUERY, { cursor }, randomUUID());
        json = await resp.json();
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        console.warn(`Reintento listado ${attempt}: ${err?.message || err}`);
        await sleep(400 * attempt);
      }
    }
    if (!resp.ok || json?.errors?.length) {
      throw new Error(JSON.stringify(json?.errors || json).slice(0, 500));
    }
    const batch = json.data.products;
    products.push(...(batch.nodes || []));
    process.stdout.write(`\rListados ${products.length} (pág. ${page})…`);
    if (!batch.pageInfo?.hasNextPage) break;
    cursor = batch.pageInfo.endCursor;
  }
  process.stdout.write('\n');
  return products;
}

async function main() {
  console.log(APPLY ? 'MODO APPLY' : 'MODO DRY-RUN');
  const all = await fetchAllProducts();
  const formProducts = all.filter((p) => isFormProduct(p.title));
  console.log(`Productos con Form: ${formProducts.length}`);

  const updates = [];
  for (const p of formProducts) {
    const variants = p.variants?.nodes || [];
    const newTitle = scrubMgmText(p.title);
    const newTags = scrubMgmTags(p.tags);
    const newDescription = scrubMgmText(p.descriptionHtml || '');
    const titleChanged = newTitle !== p.title;
    const tagsChanged = JSON.stringify(newTags) !== JSON.stringify(p.tags || []);
    const descriptionChanged = newDescription !== String(p.descriptionHtml || '');
    const skuFixes = variants
      .map((v) => {
        const nextSku = scrubMgmSku(v.sku);
        if (!v.sku || nextSku === v.sku) return null;
        return { id: v.id, sku: nextSku, from: v.sku };
      })
      .filter(Boolean);
    const priceChanged = shouldForceFormPrice(p.title) && needsPriceFix(variants);
    const skuChanged = skuFixes.length > 0;
    if (!titleChanged && !tagsChanged && !descriptionChanged && !priceChanged && !skuChanged) continue;
    updates.push({
      id: p.id,
      title: p.title,
      newTitle,
      tags: p.tags || [],
      newTags,
      descriptionHtml: p.descriptionHtml || '',
      newDescription,
      titleChanged,
      tagsChanged,
      descriptionChanged,
      priceChanged,
      skuChanged,
      skuFixes,
      variants,
      prices: variants.map((v) => v.price),
    });
  }

  console.log(`A actualizar: ${updates.length}`);
  for (const row of updates.slice(0, 60)) {
    console.log(`- ${row.title}`);
    console.log(
      `  ${row.titleChanged ? `TITLE → "${row.newTitle}"` : 'title ok'}`
      + ` | ${row.priceChanged ? `PRICE [${row.prices.join(',')}] → 12000` : 'price ok'}`
      + ` | ${row.tagsChanged ? 'tags scrub' : 'tags ok'}`
      + ` | ${row.descriptionChanged ? 'desc scrub' : 'desc ok'}`
      + ` | ${row.skuChanged ? `sku scrub (${row.skuFixes.length})` : 'sku ok'}`,
    );
  }
  if (updates.length > 60) console.log(`… y ${updates.length - 60} más`);

  if (!APPLY) {
    console.log('\nPara aplicar: node scripts/shopify-fix-form-products.mjs --apply');
    return;
  }

  let applied = 0;
  let errors = 0;
  for (const row of updates) {
    try {
      if (row.titleChanged || row.tagsChanged || row.descriptionChanged) {
        const resp = await shopifyAdminGraphQL(
          PRODUCT_UPDATE,
          {
            input: {
              id: row.id,
              ...(row.titleChanged ? { title: row.newTitle } : {}),
              ...(row.tagsChanged ? { tags: row.newTags } : {}),
              ...(row.descriptionChanged ? { descriptionHtml: row.newDescription } : {}),
            },
          },
          randomUUID(),
        );
        const json = await resp.json();
        const errs = json?.data?.productUpdate?.userErrors || [];
        if (errs.length || json.errors) {
          throw new Error(JSON.stringify(errs || json.errors));
        }
      }

      if (row.priceChanged || row.skuChanged) {
        const byId = new Map();
        for (const v of row.variants) {
          byId.set(v.id, { id: v.id });
        }
        if (row.priceChanged) {
          for (const v of row.variants) {
            byId.get(v.id).price = TARGET_PRICE;
            byId.get(v.id).compareAtPrice = null;
          }
        }
        for (const fix of row.skuFixes || []) {
          byId.get(fix.id).sku = fix.sku;
        }
        const resp = await shopifyAdminGraphQL(
          VARIANTS_UPDATE,
          {
            productId: row.id,
            variants: [...byId.values()],
          },
          randomUUID(),
        );
        const json = await resp.json();
        const errs = json?.data?.productVariantsBulkUpdate?.userErrors || [];
        if (errs.length || json.errors) {
          throw new Error(JSON.stringify(errs || json.errors));
        }
      }

      applied += 1;
      console.log(`OK ${row.newTitle.slice(0, 80)}`);
      await sleep(80);
    } catch (err) {
      errors += 1;
      console.error(`ERROR ${row.title.slice(0, 60)}: ${err?.message || err}`);
    }
  }

  console.log(`\nListo: ${applied} actualizados, ${errors} errores.`);
  if (errors) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
