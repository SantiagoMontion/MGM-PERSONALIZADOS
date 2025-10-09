import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import logger from '../../lib/_lib/logger.js';

const ALLOWED_BUCKETS = new Set(['outputs', 'preview', 'uploads']);
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_EXPIRES = 900;

function guessExtension(contentType) {
  if (typeof contentType !== 'string') return '';
  const lower = contentType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('pdf')) return 'pdf';
  return '';
}

function buildObjectPath(path, contentType) {
  const trimmed = typeof path === 'string' ? path.trim().replace(/^\/+/, '') : '';
  if (trimmed) return trimmed;
  const ext = guessExtension(contentType);
  const suffix = ext ? `.${ext}` : '';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${suffix}`;
}

function buildStorageUrl(base, bucket, key, isPublic) {
  const normalizedBase = String(base || '').replace(/\/$/, '');
  const visibility = isPublic ? 'public/' : '';
  return `${normalizedBase}/storage/v1/object/${visibility}${bucket}/${key}`;
}

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

  const body = req.body && typeof req.body === 'object' ? req.body : {};
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

  const objectPath = buildObjectPath(body.path, contentType);

  try {
    const supabase = getSupabaseAdmin();
    const storage = supabase.storage.from(bucket);
    const expiresIn = Number.isFinite(Number(body.expiresIn)) && Number(body.expiresIn) > 0
      ? Math.min(Math.round(Number(body.expiresIn)), 60 * 60 * 24)
      : DEFAULT_EXPIRES;
    const { data: signed, error } = await storage.createSignedUploadUrl(objectPath, expiresIn, {
      upsert: true,
      contentType,
    });
    if (error) {
      logger.error?.('[storage/sign] createSignedUploadUrl failed', { diagId, bucket, objectPath, error: error.message });
      res.status(500).json({ ok: false, error: 'signed_url_failed', diagId });
      return;
    }

    const base = process.env.SUPABASE_URL || '';
    const uploadUrl = buildStorageUrl(base, bucket, objectPath, false);
    const publicUrl = buildStorageUrl(base, bucket, objectPath, true);

    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      ok: true,
      bucket,
      path: objectPath,
      uploadUrl,
      publicUrl,
      expiresIn,
      token: signed?.token || null,
      signedUrl: signed?.signedUrl || null,
    });
  } catch (err) {
    logger.error?.('[storage/sign] unexpected', { diagId, error: err?.message || err });
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.status(500).json({ ok: false, error: 'internal_error', diagId });
  }
}
