#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const { evaluateImage } = await import('../lib/handlers/moderateImage.js');

async function loadImageBuffer(filePath) {
  const buf = await fs.readFile(filePath);
  // Normalize to PNG for consistency without mutating original file on disk
  return sharp(buf).png().toBuffer();
}

function summarize(results) {
  const totals = {
    tp: 0,
    tn: 0,
    fp: 0,
    fn: 0,
  };
  const corrected = [];
  for (const item of results) {
    if (item.expected === 'BLOCK' && item.result.label === 'BLOCK') totals.tp++;
    else if (item.expected === 'ALLOW' && item.result.label === 'ALLOW') totals.tn++;
    else if (item.expected === 'ALLOW' && item.result.label === 'BLOCK') totals.fp++;
    else if (item.expected === 'BLOCK' && item.result.label === 'ALLOW') totals.fn++;

    if (item.expected === 'ALLOW' && item.result.label === 'ALLOW') {
      const inhibited = item.result.reasons?.includes('pink_inhibitor');
      if (inhibited) {
        corrected.push({ file: item.file, reasons: item.result.reasons });
      }
    }
  }
  const precision = totals.tp + totals.fp === 0 ? 1 : totals.tp / (totals.tp + totals.fp);
  const recall = totals.tp + totals.fn === 0 ? 1 : totals.tp / (totals.tp + totals.fn);
  return { totals, precision, recall, corrected };
}

async function run() {
  const targetDir = process.argv[2] || process.env.MOD_QA_DIR || 'tests/moderation/qa';
  const manifestPath = path.resolve(targetDir, 'annotations.json');
  let manifest;
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error('moderation.qa', {
      ok: false,
      reason: 'manifest_missing',
      message: err?.message || String(err),
      expectedPath: manifestPath,
    });
    process.exit(1);
  }

  if (!Array.isArray(manifest) || manifest.length < 1) {
    console.error('moderation.qa', { ok: false, reason: 'manifest_empty', count: Array.isArray(manifest) ? manifest.length : 0 });
    process.exit(1);
  }

  const results = [];
  for (const entry of manifest) {
    const rel = entry.file || entry.path;
    if (!rel) continue;
    const expected = (entry.label || entry.expected || 'ALLOW').toUpperCase();
    const absolute = path.resolve(targetDir, rel);
    try {
      const buffer = await loadImageBuffer(absolute);
      const result = await evaluateImage(buffer, path.basename(rel), entry.designName || '');
      results.push({ file: rel, expected, result });
    } catch (err) {
      console.error('moderation.qa_entry_failed', {
        file: rel,
        error: err?.message || String(err),
      });
    }
  }

  const summary = summarize(results);
  console.log(JSON.stringify({ ok: true, dataset: targetDir, count: results.length, ...summary }, null, 2));
}

run().catch((err) => {
  console.error('moderation.qa_failed', err?.message || err);
  process.exit(1);
});

