import crypto from 'node:crypto';
import { readRequestBody } from '../_lib/http.js';
import logger from '../_lib/logger.js';

const HMAC_HEADER = 'x-shopify-hmac-sha256';
const RAW_BODY_LIMIT = 512 * 1024;

function getHeaderValue(req, name) {
  const header = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(header)) return header[0];
  return header;
}

function safeCompare(expected, received) {
  const expectedBuf = Buffer.from(expected || '', 'utf8');
  const receivedBuf = Buffer.from(received || '', 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

async function getRawRequestBody(req, { limit = RAW_BODY_LIMIT } = {}) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  return readRequestBody(req, { limit });
}

export default async function shopifyWebhook(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('shopify-webhook missing_webhook_secret', { diagId });
    res.status(500).json({ ok: false, error: 'misconfigured_webhook_secret' });
    return;
  }

  let rawBody;
  try {
    rawBody = await getRawRequestBody(req, { limit: RAW_BODY_LIMIT });
  } catch (err) {
    if (err?.code === 'payload_too_large') {
      logger.warn('shopify-webhook payload_too_large', { diagId });
      res.status(413).json({ ok: false, error: 'payload_too_large' });
      return;
    }
    logger.warn('shopify-webhook read_error', { diagId, err: err?.message || err });
    res.status(400).json({ ok: false, error: 'invalid_body' });
    return;
  }

  const provided = String(getHeaderValue(req, HMAC_HEADER) || '');
  if (!provided) {
    logger.warn('shopify-webhook missing_signature', { diagId });
    res.status(401).json({ ok: false, error: 'missing_signature' });
    return;
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  if (!safeCompare(digest, provided)) {
    logger.warn('shopify-webhook invalid_signature', { diagId });
    res.status(401).json({ ok: false, error: 'invalid_signature' });
    return;
  }

  logger.info('shopify-webhook validated', {
    diagId,
    topic: getHeaderValue(req, 'x-shopify-topic') || null,
    shopDomain: getHeaderValue(req, 'x-shopify-shop-domain') || null,
  });

  res.status(200).json({ ok: true });
}
