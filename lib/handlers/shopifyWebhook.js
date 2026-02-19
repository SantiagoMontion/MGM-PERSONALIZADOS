import crypto from 'node:crypto';
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
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

  if (req.body && typeof req.body === 'object') {
    const err = new Error('Body parser already consumed request body');
    err.code = 'body_already_parsed';
    throw err;
  }

  const chunks = [];
  let total = 0;

  return await new Promise((resolve, reject) => {
    req.on('error', (err) => reject(err));
    req.on('data', (chunk) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      total += buf.length;
      if (total > limit) {
        req.destroy?.();
        const err = new Error('Request entity too large');
        err.code = 'payload_too_large';
        reject(err);
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
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

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  if (!safeCompare(digest, provided)) {
    logger.warn('shopify-webhook invalid_signature', {
      diagId,
      providedPrefix: provided.slice(0, 12),
      computedPrefix: digest.slice(0, 12),
      bodyLength: rawBody.length,
    });
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
