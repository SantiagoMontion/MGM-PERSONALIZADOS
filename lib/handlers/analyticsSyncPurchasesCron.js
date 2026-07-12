import { randomUUID } from 'node:crypto';
import { maybeAutoSyncPaidOrders } from '../_lib/purchaseTracking.js';
import logger from '../_lib/logger.js';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function verifyCronSecret(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const raw = req.headers?.authorization ?? req.headers?.Authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') return false;
  return header === `Bearer ${expected}`;
}

export async function analyticsSyncPurchasesCron(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);

  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  if (!verifyCronSecret(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized', diagId });
    return;
  }

  try {
    const result = await maybeAutoSyncPaidOrders({ sinceDays: 14, force: true });
    sendJson(res, 200, { ...result, diagId, source: 'cron' });
  } catch (error) {
    logger.error?.('analytics_sync_purchases_cron_failed', {
      diagId,
      error: error?.message || error,
    });
    sendJson(res, 500, {
      ok: false,
      error: 'sync_failed',
      detail: error?.message || String(error),
      diagId,
    });
  }
}

export default analyticsSyncPurchasesCron;
