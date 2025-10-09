import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import { createSignedUploadUrl } from '../../lib/handlers/uploadUrl.js';

const ALLOWED_BUCKETS = new Set(['outputs', 'preview', 'uploads']);
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_EXPIRES = 900;

export default async function handler(req, res) {
  const diagId = randomUUID();
  const decision = ensureCors(req, res);
  if (!decision?.allowed || !decision?.allowedOrigin) {
    respondCorsDenied(req, res, decision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    res.status(405).json({ ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== 'object') {
      body = {};
    }

    const bucketRaw = typeof body.bucket === 'string' ? body.bucket.trim() : DEFAULT_BUCKET;
    const bucket = ALLOWED_BUCKETS.has(bucketRaw) ? bucketRaw : null;
    if (!bucket) {
      res.status(400).json({ ok: false, error: 'bucket_not_allowed', diagId });
      return;
    }

    const contentType = typeof body.contentType === 'string' && body.contentType.trim()
      ? body.contentType.trim()
      : '';
    if (!contentType) {
      res.status(400).json({ ok: false, error: 'content_type_required', diagId });
      return;
    }

    const expiresInRaw = Number.isFinite(Number(body.expiresIn)) && Number(body.expiresIn) > 0
      ? Math.min(Math.round(Number(body.expiresIn)), 60 * 60 * 24)
      : DEFAULT_EXPIRES;

    const signed = await createSignedUploadUrl({
      bucket,
      objectKey: body.path,
      contentType,
      expiresIn: expiresInRaw,
    });

    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      ok: true,
      bucket: signed.bucket,
      path: signed.objectKey,
      uploadUrl: signed.uploadUrl,
      publicUrl: signed.publicUrl,
      expiresIn: signed.expiresIn,
      token: signed.token,
      signedUrl: signed.signedUrl,
      diagId,
    });
  } catch (err) {
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      diagId,
      message: err?.message || 'sign_failed',
    });
  }
}
