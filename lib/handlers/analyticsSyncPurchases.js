import { randomUUID } from 'node:crypto';
import { verifyAnalyticsAccess } from '../_lib/analyticsAuth.js';
import { maybeAutoSyncPaidOrders, syncPaidOrdersFromShopify } from '../_lib/purchaseTracking.js';
import logger from '../_lib/logger.js';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readQueryValue(query, key) {
  const raw = query?.[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export async function analyticsSyncPurchases(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);

  const auth = verifyAnalyticsAccess(req);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, error: auth.error || 'unauthorized', diagId });
    return;
  }

  const sinceDaysRaw = Number(readQueryValue(req.query, 'days') ?? readQueryValue(req.query, 'since_days'));
  const sinceDays = Number.isFinite(sinceDaysRaw) && sinceDaysRaw > 0
    ? Math.min(90, Math.floor(sinceDaysRaw))
    : 14;
  const orderName = readQueryValue(req.query, 'order')
    ?? readQueryValue(req.query, 'order_name')
    ?? readQueryValue(req.query, 'name');

  try {
    const result = orderName
      ? await syncPaidOrdersFromShopify({
        sinceDays,
        orderName: typeof orderName === 'string' ? orderName : undefined,
      })
      : await maybeAutoSyncPaidOrders({ sinceDays, force: true });
    sendJson(res, 200, { ...result, diagId });
  } catch (error) {
    logger.error?.('analytics_sync_purchases_failed', {
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

export default analyticsSyncPurchases;
