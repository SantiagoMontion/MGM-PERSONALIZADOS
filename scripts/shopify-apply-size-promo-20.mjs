#!/usr/bin/env node
/**
 * Promo 20% OFF en Shopify para Classic/PRO 90×40 y 50×40.
 * price = floor(actual × 0.80), compareAtPrice = precio actual.
 *
 * Uso:
 *   node scripts/shopify-apply-size-promo-20.mjs           # dry-run
 *   node scripts/shopify-apply-size-promo-20.mjs --apply   # escribe
 *
 * Env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_API_VERSION
 * También lee C:\\Users\\santi\\Desktop\\PROGRAMAS\\NOT-ANDREANI\\.env si falta.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { shopifyAdminGraphQL } from '../lib/shopify.js';
import { detectClassicProMaterialForVariant } from '../lib/pricing/classicProMaterial.js';
import {
  SIZE_LIMITED_PROMO_PERCENT,
  applyPercentOffFloor,
  extractSizeCmFromText,
  isSizeLimitedPromoEligible,
} from '../lib/pricing/siteWideShopifyDiscount.js';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && process.env[key] == null) process.env[key] = val;
  }
}

try {
  await import('dotenv/config');
} catch {
  // optional
}
loadEnvFile('C:\\Users\\santi\\Desktop\\PROGRAMAS\\NOT-ANDREANI\\.env');

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 50;
const VARIANTS_PAGE = 100;
const APPLY_DELAY_MS = 200;
const APPLY_RETRIES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

const PRODUCTS_QUERY = `query SizePromoProducts($cursor: String) {
  products(first: ${PAGE_SIZE}, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
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

function resolveSize(product) {
  return (
    extractSizeCmFromText(product?.title)
    || extractSizeCmFromText(product?.handle)
    || null
  );
}

function alreadyHasPromo(variant, listPrice) {
  const compare = parsePrice(variant?.compareAtPrice);
  const price = parsePrice(variant?.price);
  if (compare <= 0 || price <= 0) return false;
  if (compare < listPrice) return false;
  return applyPercentOffFloor(compare, SIZE_LIMITED_PROMO_PERCENT) === price;
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
    if (!batch) throw new Error('GraphQL products query: respuesta vacía');
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
  const already = [];

  for (const product of products) {
    const size = resolveSize(product);
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

      const sizeFromVariant = extractSizeCmFromText(variant?.title) || size;
      if (!material || !sizeFromVariant) {
        skipped.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          reason: !material ? 'not_classic_or_pro' : 'no_size',
        });
        continue;
      }

      if (!isSizeLimitedPromoEligible({
        material,
        widthCm: sizeFromVariant.width,
        heightCm: sizeFromVariant.height,
      })) {
        skipped.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          material,
          size: `${sizeFromVariant.width}x${sizeFromVariant.height}`,
          reason: 'size_not_eligible',
        });
        continue;
      }

      const currentPrice = parsePrice(variant.price);
      if (currentPrice <= 0) {
        skipped.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          reason: 'zero_price',
        });
        continue;
      }

      if (alreadyHasPromo(variant, currentPrice)) {
        already.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          material,
          size: `${sizeFromVariant.width}x${sizeFromVariant.height}`,
          price: currentPrice,
          compareAt: parsePrice(variant.compareAtPrice),
        });
        continue;
      }

      // Si ya hay compare-at mayor, usamos ese como lista; si no, el precio actual.
      const existingCompare = parsePrice(variant.compareAtPrice);
      const listPrice = existingCompare > currentPrice ? existingCompare : currentPrice;
      const salePrice = applyPercentOffFloor(listPrice, SIZE_LIMITED_PROMO_PERCENT);
      if (salePrice <= 0 || salePrice >= listPrice) {
        skipped.push({
          productId: product.id,
          productTitle,
          variantId: variant.id,
          reason: 'no_change',
        });
        continue;
      }

      // Evitar doble descuento: si el precio actual ya es ~80% de algo redondo sin compare-at,
      // igual aplicamos compare-at = listPrice (current) y price = sale — correcto según brief.
      updates.push({
        productId: product.id,
        productTitle,
        variantId: variant.id,
        material,
        size: `${sizeFromVariant.width}x${sizeFromVariant.height}`,
        currentPrice,
        listPrice,
        salePrice,
      });
    }
  }

  return { updates, skipped, already };
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
      price: formatShopifyPrice(row.salePrice),
      compareAtPrice: formatShopifyPrice(row.listPrice),
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
        const userErrors = json?.data?.productVariantsBulkUpdate?.userErrors || [];
        if (resp.ok && !json?.errors?.length && !userErrors.length) break;
        if (attempt === APPLY_RETRIES) {
          console.error(`ERR ${productId}: ${JSON.stringify(userErrors || json?.errors || json).slice(0, 300)}`);
          errors += rows.length;
        } else {
          await sleep(400 * attempt);
        }
      } catch (err) {
        if (attempt === APPLY_RETRIES) {
          console.error(`ERR ${productId}: ${err?.message || err}`);
          errors += rows.length;
        } else {
          await sleep(400 * attempt);
        }
      }
    }

    if (resp?.ok && !json?.errors?.length) {
      const userErrors = json?.data?.productVariantsBulkUpdate?.userErrors || [];
      if (!userErrors.length) applied += rows.length;
    }
    await sleep(APPLY_DELAY_MS);
    if (applied % 50 === 0 && applied > 0) {
      process.stdout.write(`\rapplied=${applied} errors=${errors}`);
    }
  }
  process.stdout.write('\n');
  return { applied, errors };
}

async function main() {
  console.log(`size-promo-20 mode=${APPLY ? 'APPLY' : 'DRY-RUN'} percent=${SIZE_LIMITED_PROMO_PERCENT}`);
  const products = await fetchAllProducts();
  const { updates, skipped, already } = planUpdates(products);
  console.log(`candidates=${updates.length} already=${already.length} skipped=${skipped.length}`);
  for (const row of updates.slice(0, 12)) {
    console.log(
      `  ${row.material} ${row.size} | ${row.productTitle.slice(0, 60)} | ${row.listPrice} → ${row.salePrice}`,
    );
  }
  if (updates.length > 12) console.log(`  … +${updates.length - 12} más`);

  if (!APPLY) {
    console.log('Dry-run OK. Corré con --apply para escribir en Shopify.');
    return;
  }

  const { applied, errors } = await applyUpdates(updates);
  console.log(`done applied=${applied} errors=${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
