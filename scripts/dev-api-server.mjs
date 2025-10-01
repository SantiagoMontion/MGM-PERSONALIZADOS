#!/usr/bin/env node
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import handler from '../api/[...slug].js';

function enhanceResponse(res) {
  if (res.__enhanced) return res;
  res.status = function status(code) {
    if (Number.isFinite(code)) {
      res.statusCode = code;
    }
    return res;
  };
  res.json = function json(payload) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return res;
  };
  res.send = function send(payload) {
    if (payload === undefined || payload === null) {
      res.end();
      return res;
    }
    if (Buffer.isBuffer(payload)) {
      res.end(payload);
      return res;
    }
    if (typeof payload === 'object') {
      return res.json(payload);
    }
    res.end(String(payload));
    return res;
  };
  res.__enhanced = true;
  return res;
}

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
  const enhancedRes = enhanceResponse(res);
  try {
    await handler(req, enhancedRes);
  } catch (err) {
    console.error('[dev-api] handler_error', err);
    if (!enhancedRes.headersSent) {
      enhancedRes.status(500).json({ ok: false, error: 'handler_error' });
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
