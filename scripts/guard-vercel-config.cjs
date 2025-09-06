/* Lightweight guard to prevent legacy Now/V1 runtimes/config from landing. */
const fs = require('fs');
const path = require('path');

function readJSON(p) {
  const s = fs.readFileSync(p, 'utf8');
  try { return JSON.parse(s); } catch (e) {
    console.error(`[guard] Invalid JSON in ${p}: ${e.message}`);
    process.exit(1);
  }
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files); else files.push(full);
  }
  return files;
}

const root = process.cwd();
const files = walk(root);

// 1) Single modern vercel.json and no now.json
const vercels = files.filter(f => /(^|\\|\/)vercel\.json$/.test(f));
if (vercels.length < 1) {
  console.error('[guard] Missing vercel.json at repo root');
  process.exit(1);
}
// ensure root vercel present
if (!vercels.some(f => path.resolve(f) === path.resolve('vercel.json'))) {
  console.error('[guard] vercel.json must exist at repo root');
  process.exit(1);
}
// parse and validate root vercel.json
const vroot = readJSON(path.resolve('vercel.json'));
if (vroot.version !== 2) {
  console.error('[guard] vercel.json must have "version": 2');
  process.exit(1);
}
if (!vroot.functions) {
  console.error('[guard] vercel.json must define functions');
  process.exit(1);
}
// no legacy keys
const badKeys = ['builds', 'routes'];
for (const k of badKeys) {
  if (k in vroot) {
    console.error(`[guard] vercel.json must not include legacy key: ${k}`);
    process.exit(1);
  }
}
// other vercel.json files must not contain legacy keys
for (const f of vercels) {
  const data = readJSON(f);
  for (const k of badKeys) {
    if (k in data) {
      console.error(`[guard] ${f} contains legacy key: ${k}`);
      process.exit(1);
    }
  }
}

// 2) Purge legacy now-* runtimes and vercel-php
const legacyRegex = /(now-php|vercel-php|"use"\s*:\s*"now-)/i;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  if (legacyRegex.test(s)) {
    console.error(`[guard] Legacy Now/V1 reference found in ${f}`);
    process.exit(1);
  }
}

// 3) Per-file runtime in API must not be non-node values
const apiFiles = files.filter(f => /(^|\\|\/)api(\\|\/).+\.(js|ts)$/.test(f));
const runtimeRe = /export\s+const\s+config\s*=\s*\{[^}]*runtime\s*:\s*['"]([^'"}]+)['"][^}]*\}/g;
for (const f of apiFiles) {
  const s = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = runtimeRe.exec(s))) {
    const val = String(m[1]).toLowerCase();
    const ok = val === 'edge' || val.startsWith('node');
    if (!ok) {
      console.error(`[guard] Invalid per-file runtime '${val}' in ${f}`);
      process.exit(1);
    }
  }
}

console.log('[guard] Vercel runtime/config checks passed');
