import crypto from 'node:crypto';
import { cors } from './_lib/cors.js';
import { envCheck, corsDiagnose } from '../lib/api/handlers/system.js';
import { searchAssets } from '../lib/api/handlers/assets.js';

const routes = [
  { method: 'GET', pattern: /^env-check$/, handler: envCheck },
  { method: 'GET', pattern: /^cors-diagnose$/, handler: corsDiagnose },
  { method: 'GET', pattern: /^search-assets$/, handler: searchAssets },
];

function matchRoute(method, slug) {
  return routes.find(r => r.method === method && r.pattern.test(slug));
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve(undefined);
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const slug = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const route = matchRoute(req.method, slug);
  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await parseBody(req);
    } catch (e) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'bad_json' }));
      return;
    }
  }

  try {
    const result = await route.handler({
      method: req.method,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body,
      diagId,
    });
    const status = result?.status || 200;
    res.statusCode = status;
    if (result?.headers) {
      for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
    }
    if (status !== 204) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result?.body ?? {}));
    } else {
      res.end();
    }
  } catch (e) {
    console.error('api-router', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'internal_error', diag_id: diagId }));
  }
}
