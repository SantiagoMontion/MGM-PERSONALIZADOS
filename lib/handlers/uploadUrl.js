import crypto from 'node:crypto';
import { supa } from '../supa.js';
import { buildObjectKey } from '../_lib/slug.js';
import logger from '../_lib/logger.js';

const UPLOAD_BUCKET = 'uploads';

function normalizeBaseUrl(raw = '') {
  return String(raw || '').replace(/\/$/, '');
}

function guessExtensionFromMime(contentType = '') {
  const lower = String(contentType || '').toLowerCase();
  if (!lower) return '';
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('pdf')) return 'pdf';
  if (lower.includes('webp')) return 'webp';
  return '';
}

function buildRandomObjectKey(ext = '') {
  const rand = crypto.randomUUID?.()
    || (typeof crypto.randomBytes === 'function' ? crypto.randomBytes(12).toString('hex') : Math.random().toString(36).slice(2, 12));
  const suffix = ext ? `.${ext}` : '';
  return `${Date.now()}-${rand}${suffix}`;
}

function absolutizeSignedUrl(base, signedUrl) {
  if (!signedUrl) return null;
  if (signedUrl.startsWith('http://') || signedUrl.startsWith('https://')) {
    return signedUrl;
  }
  const normalizedBase = normalizeBaseUrl(base);
  const needsSlash = signedUrl.startsWith('/') ? '' : '/';
  return `${normalizedBase}${needsSlash}${signedUrl}`;
}

function sanitizeObjectKey(objectKey) {
  if (typeof objectKey !== 'string') return '';
  return objectKey.trim().replace(/^\/+/, '');
}

export async function createSignedUploadUrl({
  bucket = UPLOAD_BUCKET,
  objectKey,
  contentType = '',
  expiresIn,
} = {}) {
  if (!bucket) {
    throw new Error('bucket_required');
  }
  const storage = supa.storage.from(bucket);
  const fallbackExpires = resolveExpirySeconds();
  const safeExpiresIn = Number.isFinite(expiresIn) && expiresIn > 0
    ? Math.min(Math.round(expiresIn), 60 * 60 * 24)
    : fallbackExpires;
  const trimmedKey = sanitizeObjectKey(objectKey);
  const ext = guessExtensionFromMime(contentType);
  const finalKey = trimmedKey || buildRandomObjectKey(ext);
  const options = { upsert: true };
  if (contentType) {
    options.contentType = contentType;
  }
  const { data: signed, error } = await storage.createSignedUploadUrl(finalKey, safeExpiresIn, options);
  if (error) {
    throw Object.assign(new Error('signed_upload_failed'), { cause: error });
  }
  const base = normalizeBaseUrl(process.env.SUPABASE_URL || '');
  const uploadUrl = `${base}/storage/v1/object/${bucket}/${finalKey}`;
  const publicUrl = `${base}/storage/v1/object/public/${bucket}/${finalKey}`;
  const absoluteSignedUrl = absolutizeSignedUrl(base, signed?.signedUrl || null);
  return {
    bucket,
    objectKey: finalKey,
    uploadUrl,
    publicUrl,
    expiresIn: safeExpiresIn,
    token: signed?.token ?? null,
    signedUrl: absoluteSignedUrl,
  };
}

function buildCanonicalUrl(key) {
  const base = normalizeBaseUrl(process.env.SUPABASE_URL);
  return `${base}/storage/v1/object/public/${UPLOAD_BUCKET}/${key}`;
}

function buildDirectUploadUrl(key) {
  const base = normalizeBaseUrl(process.env.SUPABASE_URL);
  return `${base}/storage/v1/object/${UPLOAD_BUCKET}/${key}`;
}

function toSignedUpload({ signedUrl, token }) {
  if (!signedUrl || !token) return null;
  const base = normalizeBaseUrl(process.env.SUPABASE_URL);
  const absolute = signedUrl.startsWith('http')
    ? signedUrl
    : `${base}${signedUrl.startsWith('/') ? '' : '/'}${signedUrl}`;
  return {
    signed_url: absolute,
    token,
  };
}

function resolveExpirySeconds() {
  const raw = Number(process.env.SIGNED_UPLOAD_EXPIRES_IN || process.env.UPLOAD_URL_EXPIRES_IN || 900);
  if (!Number.isFinite(raw) || raw <= 0) return 900;
  return Math.min(Math.max(Math.round(raw), 60), 60 * 60 * 24);
}

function validateUploadBody(body) {
  if (!body || typeof body !== 'object') return 'invalid_body';
  const { design_name, ext, mime, size_bytes, material, w_cm, h_cm, sha256 } = body;
  if (typeof design_name !== 'string' || design_name.trim().length === 0) return 'design_name_required';
  if (!['jpg','jpeg','png','webp'].includes(String(ext))) return 'ext_invalid';
  if (typeof mime !== 'string' || !/^[\w.-]+\/[\w.+-]+$/.test(mime)) return 'mime_invalid';
  if (typeof size_bytes !== 'number' || !Number.isFinite(size_bytes) || size_bytes <= 0) return 'size_invalid';
  if (!['Classic','PRO'].includes(String(material))) return 'material_invalid';
  if (typeof w_cm !== 'number' || !(w_cm > 0)) return 'w_cm_invalid';
  if (typeof h_cm !== 'number' || !(h_cm > 0)) return 'h_cm_invalid';
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return 'sha256_invalid';
  return null;
}

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 40);
const LIMITS = { Classic: { maxW: 140, maxH: 100 }, PRO: { maxW: 120, maxH: 60 } };

export default async function uploadUrl(req, res) {
  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: 'missing_env', diag_id: diagId });
  }

  try {
    let raw = req.body;
    if (!raw || typeof raw !== 'object') {
      raw = await new Promise((resolve, reject) => {
        let b = ''; req.on('data', c => b += c); req.on('end', () => resolve(b)); req.on('error', reject);
      });
      try { raw = JSON.parse(String(raw || '{}')); } catch {}
    }
    const vErr = validateUploadBody(raw || {});
    if (vErr) {
      return res.status(400).json({ ok: false, diag_id: diagId, message: vErr });
    }
    const body = raw;

    if ((body.size_bytes || 0) > MAX_MB * 1024 * 1024) {
      return res.status(400).json({ ok: false, diag_id: diagId, message: 'file_too_large' });
    }
    const lim = LIMITS[body.material];
    if (!lim) return res.status(400).json({ ok: false, diag_id: diagId, message: 'invalid_material' });
    if (body.w_cm > lim.maxW || body.h_cm > lim.maxH) {
      return res.status(400).json({ ok: false, diag_id: diagId, message: 'size_exceeds_limit' });
    }

    const key = buildObjectKey({
      design_name: body.design_name,
      w_cm: body.w_cm,
      h_cm: body.h_cm,
      material: body.material,
      hash: body.sha256,
      ext: body.ext,
    });

    const storage = supa.storage.from(UPLOAD_BUCKET);
    const expiresIn = resolveExpirySeconds();
    const { data: signed, error } = await storage.createSignedUploadUrl(key, expiresIn, { upsert: true });
    if (error) {
      logger.error('upload-url signed', { diagId, error: error.message });
      return res.status(500).json({ ok: false, diag_id: diagId, message: 'supabase_signed_error' });
    }

    const canonical = buildCanonicalUrl(key);
    const direct = buildDirectUploadUrl(key);
    const upload = toSignedUpload(signed || {}, key);

    return res.status(200).json({
      ok: true,
      object_key: key,
      upload_url: direct,
      file_original_url: canonical,
      canonical_url: canonical,
      upload: upload ? { ...upload, expires_in: expiresIn } : null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'internal_error' });
  }
}

