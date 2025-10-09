import shopifyWebhook from '../lib/handlers/shopifyWebhook.js';
import logger from '../lib/_lib/logger.js';
import { resolveEnvRequirements, collectMissingEnv } from '../api/_lib/envChecks.js';

const REQUIRED_ENV = resolveEnvRequirements(
  'SHOPIFY_ADMIN',
  'SUPABASE_SERVICE',
  'SHOPIFY_WEBHOOK_SECRET',
);

export default async function handler(req, res) {
  if ((req.method || '').toUpperCase() !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    res.statusCode = 405;
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }

  const missing = collectMissingEnv(REQUIRED_ENV);
  if (missing.length) {
    try {
      logger.warn?.('shopify_webhook_missing_env', { missing });
    } catch {}
    res.statusCode = 500;
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'missing_env', missing }));
    return;
  }

  try {
    await shopifyWebhook(req, res);
  } catch (err) {
    try {
      logger.error?.('shopify_webhook_handler_error', { message: err?.message || err });
    } catch {}
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'handler_error' }));
    }
  }
}
