#!/usr/bin/env node
/**
 * Rebaja 15% el precio de variantes Classic/PRO ya publicadas en Shopify.
 * Sin compare-at (no se ve como oferta).
 *
 * Uso:
 *   node scripts/shopify-reduce-classic-pro-prices.mjs           # dry-run (default)
 *   node scripts/shopify-reduce-classic-pro-prices.mjs --apply   # escribe en Shopify
 *
 * Requiere: SHOPIFY_STORE_DOMAIN (o SHOPIFY_SHOP), SHOPIFY_ADMIN_TOKEN, SHOPIFY_API_VERSION
 */
import { randomUUID } from 'node:crypto';
import { shopifyAdminGraphQL } from '../lib/shopify.js';
import {
  applyClassicProPriceReduction,
  CLASSIC_PRO_PRICE_REDUCTION_PERCENT,
  detectClassicProMaterialForVariant,
} from '../lib/pricing/classicProMaterial.js';

try {
  await import('dotenv/config');
} catch {
  // optional
}

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 50;
const VARIANTS_PAGE = 100;
const APPLY_DELAY_MS = 250;
const APPLY_RETRIES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Evita doble rebaja al reanudar tras un corte de red. */
function isAlreadyAtReducedPrice(currentPrice) {
  const factor = (100 - CLASSIC_PRO_PRICE_REDUCTION_PERCENT) / 100;
  const candidateOriginal = Math.round(currentPrice / factor);
  if (candidateOriginal <= currentPrice) return false;
  if (candidateOriginal % 100 !== 0) return false;
  return applyClassicProPriceReduction(candidateOriginal) === currentPrice;
}

const PRODUCTS_QUERY = `query ClassicProProducts($cursor: String) {
  products(first: ${PAGE_SIZE}, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      tags
      variants(first: ${VARIANTS_PAGE}) {
        nodes {
          id
          title
          price
          compareAtPrice
          selectedOptions { name value }
        }
      }
    }
  }
}`;

const BULK_UPDATE_MUTATION = `mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id price compareAtPrice }
    userErrors { field message }
  }
}`;

function formatShopifyPrice(amount) {
  const n = Math.round(Number(amount) || 0);
  return `${n}.00`;
}

function parsePrice(value) {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function fetchAllProducts() {
  const products = [];
  let cursor = null;
  let page = 0;
  while (true) {
    page += 1;
    const resp = await shopifyAdminGraphQL(PRODUCTS_QUERY, { cursor }, randomUUID());
    const json = await resp.json();
    if (!resp.ok || json?.errors?.length) {
      throw new Error(`GraphQL products query failed: ${JSON.stringify(json?.errors ?? json).slice(0, 500)}`);
    }
    const batch = json?.data?.products;
    if (!batch) {
      throw new Error('GraphQL products query: respuesta vacía');
    }
    const nodes = Array.isArray(batch.nodes) ? batch.nodes : [];
    products.push(...nodes);
    process.stdout.write(`\rListados ${products.length} productos (pág. ${page})…`);
    if (!batch.pageInfo?.hasNextPage) break;
    cursor = batch.pageInfo.endCursor;
  }
  process.stdout.write('\n');
  return products;
}

function planUpdates(products) {
  const updates = [];
  const skipped = [];
  const ambiguous = [];

  for (const product of products) {
    const variants = product?.variants?.nodes ?? [];
    const productTags = product?.tags ?? [];
    const productTitle = product?.title ?? '';

    for (const variant of variants) {
      const material = detectClassicProMaterialForVariant({
        productTags,
        productTitle,
        variantTitle: variant?.title ?? '',
        selectedOptions: variant?.selectedOptions ?? [],
      });

      if (!material) {
        skipped.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          variantTitle: variant.title,
          reason: 'not_classic_or_pro',
        });
        continue;
      }

      const currentPrice = parsePrice(variant.price);
      if (currentPrice > 0 && isAlreadyAtReducedPrice(currentPrice)) {
        ambiguous.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          variantTitle: variant.title,
          material,
          currentPrice,
          reason: 'already_reduced',
        });
        continue;
      }

      if (currentPrice <= 0) {
        ambiguous.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          variantTitle: variant.title,
          reason: 'zero_price',
        });
        continue;
      }

      const newPrice = applyClassicProPriceReduction(currentPrice);
      if (newPrice <= 0 || newPrice >= currentPrice) {
        ambiguous.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          variantTitle: variant.title,
          material,
          currentPrice,
          newPrice,
          reason: 'no_change',
        });
        continue;
      }

      updates.push({
        productId: product.id,
        productTitle,
        variantId: variant.id,
        variantTitle: variant.title,
        material,
        currentPrice,
        newPrice,
        hadCompareAt: Boolean(variant.compareAtPrice),
      });
    }
  }

  return { updates, skipped, ambiguous };
}

async function applyUpdates(updates) {
  const byProduct = new Map();
  for (const row of updates) {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, []);
    byProduct.get(row.productId).push(row);
  }

  let applied = 0;
  let errors = 0;

  for (const [productId, rows] of byProduct.entries()) {
    const variants = rows.map((row) => ({
      id: row.variantId,
      price: formatShopifyPrice(row.newPrice),
      compareAtPrice: null,
    }));

    let resp;
    let json;
    for (let attempt = 1; attempt <= APPLY_RETRIES; attempt += 1) {
      try {
        resp = await shopifyAdminGraphQL(
          BULK_UPDATE_MUTATION,
          { productId, variants },
          randomUUID(),
        );
        json = await resp.json();
        break;
      } catch (err) {
        if (attempt >= APPLY_RETRIES) throw err;
        const waitMs = APPLY_DELAY_MS * attempt * 2;
        console.warn(`Reintento ${attempt}/${APPLY_RETRIES} en ${productId}: ${err?.message ?? err}`);
        await sleep(waitMs);
      }
    }

    if (APPLY_DELAY_MS > 0) await sleep(APPLY_DELAY_MS);
    const userErrors = json?.data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (userErrors.length || !resp.ok) {
      errors += rows.length;
      console.error('ERROR', productId, userErrors, json?.errors);
      continue;
    }
    applied += rows.length;
    for (const row of rows) {
      console.log(
        `OK ${row.material} ${row.productTitle.slice(0, 50)} | `
        + `${row.variantTitle}: $${row.currentPrice} → $${row.newPrice}`,
      );
    }
  }

  return { applied, errors };
}

async function main() {
  console.log(APPLY ? 'MODO APPLY (escribe en Shopify)' : 'MODO DRY-RUN (solo preview)');
  const products = await fetchAllProducts();
  const { updates, skipped, ambiguous } = planUpdates(products);

  console.log(`\nProductos escaneados: ${products.length}`);
  console.log(`Variantes Classic/PRO a actualizar: ${updates.length}`);
  console.log(`Variantes omitidas (otros materiales): ${skipped.length}`);
  console.log(`Variantes ambiguas / sin cambio: ${ambiguous.length}`);

  if (updates.length) {
    console.log('\nPreview (primeras 25):');
    for (const row of updates.slice(0, 25)) {
      console.log(
        `  [${row.material}] ${row.productTitle.slice(0, 55)}`
        + ` / ${row.variantTitle}: $${row.currentPrice} → $${row.newPrice}`
        + (row.hadCompareAt ? ' (limpia compare-at)' : ''),
      );
    }
    if (updates.length > 25) console.log(`  … y ${updates.length - 25} más`);
  }

  if (ambiguous.length) {
    console.log('\nAmbiguos (revisar manualmente):');
    for (const row of ambiguous.slice(0, 10)) {
      console.log(`  ${row.productTitle} / ${row.variantTitle}: ${row.reason}`);
    }
  }

  if (!APPLY) {
    console.log('\nPara aplicar: node scripts/shopify-reduce-classic-pro-prices.mjs --apply');
    return;
  }

  const { applied, errors } = await applyUpdates(updates);
  console.log(`\nListo: ${applied} variantes actualizadas, ${errors} errores.`);
  if (errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
