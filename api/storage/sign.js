import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import { createSignedUploadUrl } from '../../lib/handlers/uploadUrl.js';

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

function parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
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
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed', diagId }));
    return;
  }

  const body = parseBody(req.body);
  const bucketRaw = typeof body.bucket === 'string' ? body.bucket.trim() : '';
  const bucket = ALLOWED_BUCKETS.has(bucketRaw) ? bucketRaw : DEFAULT_BUCKET;
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
  if (!contentType) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'content_type_required', diagId }));
    return;
  }
  const objectPath = buildObjectPath(body.path, contentType);
  if (!objectPath) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'path_invalid', diagId }));
    return;
  }
  const expiresRaw = Number(body.expiresIn);
  const expiresIn = Number.isFinite(expiresRaw) && expiresRaw > 0
    ? Math.min(Math.round(expiresRaw), 3600)
    : DEFAULT_EXPIRES;

  try {
    const { uploadUrl, publicUrl, upload } = await createSignedUploadUrl({
      bucket,
      objectKey: objectPath,
      contentType,
      expiresIn,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      diagId,
      bucket,
      path: objectPath,
      uploadUrl,
      publicUrl,
      expiresIn,
      token: upload?.token || null,
      signedUrl: upload?.signed_url || null,
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: false,
      diagId,
      error: 'sign_failed',
      message: error?.message || String(error || ''),
    }));
  }
}
