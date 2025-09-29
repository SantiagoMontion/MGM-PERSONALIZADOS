#!/usr/bin/env node
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import handler from '../api/[...slug].js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function parseEnvValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice(7)
    : trimmed;
  const equalsIndex = withoutExport.indexOf('=');
  if (equalsIndex === -1) return { key: withoutExport.trim(), value: '' };
  const key = withoutExport.slice(0, equalsIndex).trim();
  let value = withoutExport.slice(equalsIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadEnvFile(filename) {
  const absolute = path.join(projectRoot, filename);
  if (!fs.existsSync(absolute)) return;
  const content = fs.readFileSync(absolute, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parsed = parseEnvValue(trimmed);
    if (!parsed?.key) continue;
    const { key, value } = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function bootstrapEnv() {
  const envFiles = ['.env.local', '.env.development', '.env'];
  for (const file of envFiles) {
    loadEnvFile(file);
  }
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development';
  }
}

bootstrapEnv();

const port = Number(process.env.API_PORT || process.env.PORT || 3001);

const server = http.createServer(async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error('[dev-api] handler_error', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'handler_error' }));
    }
  }
});

server.listen(port, () => {
  console.log(`\n[dev-api] Listening on http://localhost:${port}`);
  console.log('[dev-api] Press Ctrl+C to stop.');
});

function shutdown() {
  console.log('\n[dev-api] Shutting down...');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
