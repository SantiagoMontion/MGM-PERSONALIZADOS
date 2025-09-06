#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}

const files = walk(root);
const vercels = files.filter(f => /(^|[\\/])vercel\.json$/.test(f));

let ok = true;
if (vercels.length < 1) {
  console.error('[doctor] Missing vercel.json at repo root');
  ok = false;
} else {
  const rootVercel = path.join(root, 'vercel.json');
  if (!vercels.includes(rootVercel)) {
    console.error('[doctor] vercel.json must be at repo root only');
    ok = false;
  } else {
    try {
      const j = JSON.parse(fs.readFileSync(rootVercel, 'utf8'));
      const clean = JSON.stringify(j);
      if (clean !== JSON.stringify({ version: 2 })) {
        console.error('[doctor] vercel.json must be strictly { "version": 2 }');
        ok = false;
      }
    } catch (e) {
      console.error('[doctor] vercel.json invalid JSON:', e.message);
      ok = false;
    }
  }
}

const redFlags = ['now-php', '"builds"', '"routes"', '"version"\s*:\s*1'];
for (const f of vercels) {
  const content = fs.readFileSync(f, 'utf8');
  for (const p of redFlags) {
    const re = new RegExp(p, 'i');
    if (re.test(content)) {
      console.warn('[doctor] Found legacy pattern in', f, '->', p);
      ok = false;
    }
  }
}

if (!ok) process.exit(1);
console.log('[doctor] vercel config looks good');
