import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { buildObjectKey } from '../../lib/_lib/slug.js';
import logger from '../../lib/_lib/logger.js';
import {
  ensureCors,
  handlePreflight,
  respondCorsDenied,
  applyCorsHeaders,
  type CorsDecision,
} from '../_lib/cors.js';

const UPLOAD_BUCKET = 'uploads';
const DEFAULT_EXPIRES_IN = 900;

function normalizeBaseUrl(raw?: string | null): string {
  return typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildSignedUploadUrl(baseUrl: string, signedUrl?: string | null, token?: string | null): string | null {
  if (!signedUrl) return null;
  const prefix = signedUrl.startsWith('/') ? '' : '/';
  let absolute = `${baseUrl}${prefix}${signedUrl}`;
  if (token && !absolute.includes('token=')) {
    const joiner = absolute.includes('?') ? '&' : '?';
    absolute = `${absolute}${joiner}token=${encodeURIComponent(token)}`;
  }
  return absolute;
}

function resolveExpirySeconds(): number {
  const raw = Number(
    process.env.UPLOAD_ORIGINAL_SIGNED_EXPIRES_IN
      || process.env.SIGNED_UPLOAD_EXPIRES_IN
      || process.env.UPLOAD_URL_EXPIRES_IN
      || DEFAULT_EXPIRES_IN,
  );
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_EXPIRES_IN;
  const clamped = Math.round(raw);
  return Math.min(Math.max(clamped, 60), 60 * 60 * 24);
}

async function readJsonBody(req: VercelRequest): Promise<Record<string, any> | null> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, any>;
  }
  const raw = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', (err) => reject(err));
  });
  if (!raw) return {};
  try {
    return JSON.parse(String(raw));
  } catch (err) {
    logger.warn?.('upload-original start invalid_json', { error: err?.message || err });
    return null;
  }
}

function inferExtension({ ext, filename, contentType }: { ext?: string | null; filename?: string | null; contentType?: string | null; }): string {
  const normalizedExt = typeof ext === 'string' ? ext.trim().toLowerCase() : '';
  if (/^[a-z0-9]{1,10}$/i.test(normalizedExt)) return normalizedExt;
  if (typeof filename === 'string') {
    const match = /\.([a-z0-9]{1,10})$/i.exec(filename.trim());
    if (match) return match[1].toLowerCase();
  }
  if (typeof contentType === 'string') {
    const trimmed = contentType.trim().toLowerCase();
    if (trimmed === 'image/png') return 'png';
    if (trimmed === 'image/jpeg' || trimmed === 'image/jpg') return 'jpg';
    if (trimmed === 'image/webp') return 'webp';
    if (trimmed === 'application/pdf') return 'pdf';
  }
  return 'bin';
}

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function respond(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  status: number,
  payload: Record<string, any>,
): void {
  applyCorsHeaders(req, res, corsDecision);
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(payload);
    return;
  }
  res.statusCode = status;
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  } catch {}
  res.end(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = randomUUID();
  res.setHeader('X-Upload-Diag-Id', diagId);

  const corsDecision = ensureCors(req, res);
  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  if ((req.method || '').toUpperCase() === 'OPTIONS') {
    handlePreflight(req, res, corsDecision);
    return;
  }

  if ((req.method || '').toUpperCase() !== 'POST') {
    respond(req, res, corsDecision, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    respond(req, res, corsDecision, 400, { ok: false, error: 'invalid_body', diagId });
    return;
  }

  const {
    filename,
    contentType,
    rid,
    sha256,
    design_name,
    designName,
    material,
    w_cm,
    width_cm,
    h_cm,
    height_cm,
    sizeBytes,
    size_bytes,
    ext,
  } = body as Record<string, any>;

  const normalizedName = typeof design_name === 'string' && design_name.trim()
    ? design_name.trim()
    : typeof designName === 'string' && designName.trim()
      ? designName.trim()
      : '';

  const materialValue = typeof material === 'string' ? material.trim() : '';
  const widthValue = toPositiveNumber(w_cm) ?? toPositiveNumber(width_cm);
  const heightValue = toPositiveNumber(h_cm) ?? toPositiveNumber(height_cm);
  const declaredSize = toPositiveNumber(sizeBytes) ?? toPositiveNumber(size_bytes);
  const declaredContentType = typeof contentType === 'string' && contentType.trim()
    ? contentType.trim()
    : '';
  const sha = typeof sha256 === 'string' ? sha256.trim().toLowerCase() : '';

  if (!normalizedName) {
    respond(req, res, corsDecision, 400, { ok: false, error: 'design_name_required', diagId });
    return;
  }
  if (!materialValue) {
    respond(req, res, corsDecision, 400, { ok: false, error: 'material_required', diagId });
    return;
  }
  if (!widthValue) {
    respond(req, res, corsDecision, 400, { ok: false, error: 'width_invalid', diagId });
    return;
  }
  if (!heightValue) {
    respond(req, res, corsDecision, 400, { ok: false, error: 'height_invalid', diagId });
    return;
  }
  if (!sha || !/^[a-f0-9]{64}$/.test(sha)) {
    respond(req, res, corsDecision, 400, { ok: false, error: 'sha256_invalid', diagId });
    return;
  }

  const extension = inferExtension({ ext, filename, contentType: declaredContentType });
  const objectKey = buildObjectKey({
    design_name: normalizedName,
    w_cm: widthValue,
    h_cm: heightValue,
    material: materialValue,
    hash: sha,
    ext: extension,
  });

  const baseUrl = normalizeBaseUrl(process.env.SUPABASE_URL);
  if (!baseUrl) {
    respond(req, res, corsDecision, 500, { ok: false, error: 'supabase_not_configured', diagId });
    return;
  }

  try {
    const { supa } = await import('../../lib/supa.js');
    const storage = supa.storage.from(UPLOAD_BUCKET);
    const expiresIn = resolveExpirySeconds();
    const { data, error } = await storage.createSignedUploadUrl(objectKey, expiresIn, { upsert: true });
    if (error) {
      logger.error?.('upload-original start signed_url_error', {
        diagId,
        bucket: UPLOAD_BUCKET,
        objectKey,
        message: error?.message,
        status: error?.status ?? error?.statusCode ?? null,
        name: error?.name,
      });
      respond(req, res, corsDecision, 500, { ok: false, error: 'signed_upload_error', diagId });
      return;
    }

    const uploadUrl = buildSignedUploadUrl(baseUrl, data?.signedUrl ?? null, data?.token ?? null);
    if (!uploadUrl) {
      respond(req, res, corsDecision, 500, { ok: false, error: 'signed_upload_unavailable', diagId });
      return;
    }

    const sessionId = randomUUID();
    const canonical = `${baseUrl}/storage/v1/object/public/${UPLOAD_BUCKET}/${encodePath(objectKey)}`;

    respond(req, res, corsDecision, 200, {
      ok: true,
      diagId,
      sessionId,
      uploadUrl,
      uploadUrlExpiresIn: expiresIn,
      objectKey,
      originalKey: objectKey,
      originalUrl: canonical,
      rid: typeof rid === 'string' && rid ? rid : undefined,
      sizeBytes: declaredSize ?? null,
      contentType: declaredContentType || null,
    });
  } catch (err) {
    logger.error?.('upload-original start exception', {
      diagId,
      bucket: UPLOAD_BUCKET,
      objectKey,
      error: err?.message || err,
    });
    respond(req, res, corsDecision, 500, { ok: false, error: 'start_exception', diagId });
  }
}
