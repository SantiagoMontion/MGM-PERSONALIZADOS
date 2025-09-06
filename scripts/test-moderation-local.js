#!/usr/bin/env node
// Manual test runner for moderation heuristics (no images committed)
// Usage: node scripts/test-moderation-local.js
// Place test images under tests/fixtures/<name>.{jpg,png}

import fs from 'node:fs';
import path from 'node:path';
import { evaluateImage } from '../lib/handlers/moderateImage.js';

const dir = path.join(process.cwd(), 'tests', 'fixtures');
if (!fs.existsSync(dir)) {
  console.error('No fixtures found at', dir);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
if (files.length === 0) {
  console.error('No image files in', dir);
  process.exit(1);
}

for (const f of files) {
  const p = path.join(dir, f);
  const buf = fs.readFileSync(p);
  const out = await evaluateImage(buf, f);
  console.log(`${f}: ${out.blocked ? 'BLOCK' : 'ALLOW'}${out.reason ? ' ('+out.reason+')' : ''}`);
}

