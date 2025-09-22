import crypto from 'node:crypto';
import { readRequestBody } from '../_lib/http.js';

const HMAC_HEADER = 'x-shopify-hmac-sha256';

function safeCompare(expected, received) {
  const expectedBuf = Buffer.from(expected || '', 'utf8');
  const receivedBuf = Buffer.from(received || '', 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export default async function shopifyWebhook(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, diag_id: diagId, error: 'missing_webhook_secret' });
  }

  let rawBody;
  try {
    rawBody = await readRequestBody(req, { limit: 512 * 1024 });
  } catch (err) {
    if (err?.code === 'payload_too_large') {
      return res.status(413).json({ ok: false, diag_id: diagId, error: 'payload_too_large' });
    }
    console.error('shopify-webhook read_error', err);
    return res.status(400).json({ ok: false, diag_id: diagId, error: 'invalid_body' });
  }

  const signatureHeader = req.headers?.[HMAC_HEADER] || req.headers?.[HMAC_HEADER.toUpperCase()];
  const provided = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!provided) {
    return res.status(401).json({ ok: false, diag_id: diagId, error: 'missing_signature' });
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  if (!safeCompare(digest, provided)) {
    console.error('shopify-webhook invalid_signature', { diagId });
    return res.status(401).json({ ok: false, diag_id: diagId, error: 'invalid_signature' });
  }

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    console.error('shopify-webhook json_error', { diagId, err: err?.message || err });
    return res.status(400).json({ ok: false, diag_id: diagId, error: 'invalid_json' });
  }

  const topicHeader = req.headers?.['x-shopify-topic'] || req.headers?.['X-Shopify-Topic'];
  const topic = Array.isArray(topicHeader) ? topicHeader[0] : topicHeader;

  return res.status(200).json({ ok: true, diag_id: diagId, received: true, topic: topic || null, ts: Date.now() });
}

