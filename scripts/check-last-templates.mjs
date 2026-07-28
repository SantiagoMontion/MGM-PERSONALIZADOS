#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { shopifyAdminGraphQL } from '../lib/shopify.js';
import { resolveThemeTemplateSuffixFromTitle } from '../lib/shopify/themeTemplateSuffix.js';

try { await import('dotenv/config'); } catch {}

const APPLY = process.argv.includes('--apply');

const QUERY = `query LastProducts {
  products(first: 60, sortKey: CREATED_AT, reverse: true) {
    nodes { id title templateSuffix createdAt tags }
  }
}`;

const MUTATION = `mutation ProductTemplateUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id templateSuffix }
    userErrors { field message }
  }
}`;

const resp = await shopifyAdminGraphQL(QUERY, {}, randomUUID());
const json = await resp.json();
if (!resp.ok || json.errors) {
  console.error(JSON.stringify(json.errors || json, null, 2));
  process.exit(1);
}

const nodes = json.data.products.nodes;
let ok = 0;
let bad = 0;
const badRows = [];

for (const p of nodes) {
  const expected = resolveThemeTemplateSuffixFromTitle(p.title);
  const actual = (p.templateSuffix || '').trim() || null;
  const match = actual === expected;
  if (match) ok += 1;
  else {
    bad += 1;
    badRows.push({ id: p.id, title: p.title, createdAt: p.createdAt, actual, expected, tags: p.tags });
  }
  console.log(
    [
      match ? 'OK' : 'BAD',
      actual || '(default)',
      `exp:${expected || '(default)'}`,
      p.createdAt.slice(0, 19),
      p.title.slice(0, 75),
    ].join(' | '),
  );
}

console.log('\n---');
console.log(`OK ${ok}  BAD ${bad}  total ${nodes.length}`);

if (!APPLY || !badRows.length) {
  if (badRows.length) console.log('\nPara corregir: node scripts/check-last-templates.mjs --apply');
  process.exit(bad ? 1 : 0);
}

let fixed = 0;
let errors = 0;
for (const row of badRows) {
  const r = await shopifyAdminGraphQL(
    MUTATION,
    { input: { id: row.id, templateSuffix: row.expected ?? '' } },
    randomUUID(),
  );
  const j = await r.json();
  const errs = j?.data?.productUpdate?.userErrors ?? [];
  if (errs.length || j.errors) {
    errors += 1;
    console.error('ERROR', row.title.slice(0, 60), errs, j.errors);
    continue;
  }
  fixed += 1;
  console.log(`FIXED ${(row.actual || '(default)')} → ${(row.expected || '(default)')} | ${row.title.slice(0, 70)}`);
}
console.log(`\nListo: ${fixed} corregidos, ${errors} errores.`);
process.exit(errors ? 1 : 0);
