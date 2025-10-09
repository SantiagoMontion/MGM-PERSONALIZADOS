import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { supa } from '../../lib/supa.js';
import logger from '../../lib/_lib/logger.js';
import { slugifyName } from '../../lib/_lib/slug.js';
import {
  ensureCors,
  respondCorsDenied,
  applyCorsHeaders,
} from '../_lib/cors.js';
import type { CorsDecision } from '../_lib/cors.js';

const UPLOAD_BUCKET = 'uploads';
const VALID_EXTENSIONS = ['jpg', 'png', 'webp'] as const;
const RESPONSE_ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;
const EXTENSION_BY_MIME: Record<string, typeof VALID_EXTENSIONS[number]> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

type NormalizedBody = Record<string, unknown>;

function applyUploadCors(
  req: VercelRequest,
  res: VercelResponse,
  decision?: CorsDecision,
): CorsDecision {
  const resolved = applyCorsHeaders(req, res, decision);
  try {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-file-name, x-diag');
  } catch {}
  return resolved;
}

async function readJsonBody(req: VercelRequest): Promise<NormalizedBody> {
  const existing = (req as unknown as { body?: unknown }).body;
  if (existing && typeof existing === 'object' && !Buffer.isBuffer(existing)) {
    return existing as NormalizedBody;
  }
  if (typeof existing === 'string') {
    try {
      return JSON.parse(existing) as NormalizedBody;
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(existing)) {
    try {
      return JSON.parse(existing.toString('utf8')) as NormalizedBody;
    } catch {
      return {};
    }
  }

  const raw = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', (err) => reject(err));
  });

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as NormalizedBody;
  } catch {
    return {};
  }
}

function getHeaderString(req: VercelRequest, name: string): string | null {
  const header = req.headers?.[name.toLowerCase()];
  if (Array.isArray(header)) {
    for (const value of header) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  return null;
}

function pickFirstString(...candidates: Array<unknown>): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return '';
}

function extractFileName(body: NormalizedBody, req: VercelRequest): string {
  const fromBody = pickFirstString(
    body.fileName,
    body.filename,
    body.originalFilename,
    body.name,
    (body.file as { name?: unknown })?.name,
  );
  if (fromBody) {
    return fromBody;
  }
  const header = getHeaderString(req, 'x-file-name');
  return header || '';
}

function sanitizeExtension(ext: string): string {
  if (!ext) return '';
  const normalized = ext.replace(/^\.+/, '').trim().toLowerCase();
  if (normalized === 'jpeg') return 'jpg';
  return normalized;
}

function inferExtension({
  body,
  req,
}: {
  body: NormalizedBody;
  req: VercelRequest;
}): {
  ext: string;
  source: 'file_type' | 'filename' | 'mime' | 'header' | 'unknown';
} {
  const fileType = pickFirstString(
    (body.file as { type?: unknown })?.type,
    body.fileType,
    body.file_type,
  );
  if (fileType) {
    const ext = EXTENSION_BY_MIME[fileType.toLowerCase()];
    if (ext) {
      return { ext, source: 'file_type' };
    }
  }

  const fileName = extractFileName(body, req);
  if (fileName) {
    const match = /\.([a-zA-Z0-9]{1,10})$/.exec(fileName);
    if (match) {
      const ext = sanitizeExtension(match[1]);
      if (ext) {
        return { ext, source: 'filename' };
      }
    }
  }

  const mimeCandidate = pickFirstString(
    body.mime,
    body.mime_type,
    body.contentType,
    body.content_type,
    body.file_content_type,
    body.fileMime,
    body.file_mime,
    (body.file as { type?: unknown })?.type,
    getHeaderString(req, 'x-file-mime'),
  );
  if (mimeCandidate) {
    const ext = EXTENSION_BY_MIME[mimeCandidate.toLowerCase()];
    if (ext) {
      return { ext, source: 'mime' };
    }
  }

  const headerMime = getHeaderString(req, 'content-type');
  if (headerMime) {
    const ext = EXTENSION_BY_MIME[headerMime.toLowerCase()];
    if (ext) {
      return { ext, source: 'header' };
    }
  }

  return { ext: '', source: 'unknown' };
}

function resolveAllowedExtensions(): string[] {
  return Array.from(RESPONSE_ALLOWED_EXTENSIONS);
}

function isValidExtension(ext: string): boolean {
  return (VALID_EXTENSIONS as readonly string[]).includes(ext);
}

function resolveMime(ext: string, fallback: string | null): string {
  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }
  if (fallback && typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim();
  }
  return 'application/octet-stream';
}

function buildBaseUrl(): string {
  const raw = typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL.trim() : '';
  return raw.replace(/\/$/, '');
}

function buildDirectUploadUrl(key: string): string {
  const base = buildBaseUrl();
  const sanitizedKey = key.replace(/^\/+/, '');
  return `${base}/storage/v1/object/${UPLOAD_BUCKET}/${sanitizedKey}`;
}

function buildPublicUrl(key: string): string {
  const base = buildBaseUrl();
  const sanitizedKey = key.replace(/^\/+/, '');
  return `${base}/storage/v1/object/public/${UPLOAD_BUCKET}/${sanitizedKey}`;
}

function resolveExpirySeconds(): number {
  const raw = Number(process.env.SIGNED_UPLOAD_EXPIRES_IN || process.env.UPLOAD_URL_EXPIRES_IN || 900);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 900;
  }
  return Math.min(Math.max(Math.round(raw), 60), 60 * 60 * 24);
}

function resolveRid(body: NormalizedBody, req: VercelRequest, fallback: string): string {
  const rid = pickFirstString(
    body.rid,
    body.requestId,
    body.request_id,
    body.uploadDiagId,
    body.diagId,
    getHeaderString(req, 'x-rid'),
    getHeaderString(req, 'x-mgm-rid'),
    getHeaderString(req, 'x-flow-rid'),
  );
  return rid || fallback;
}

function sanitizeSegment(value: string, fallback: string): string {
  if (!value) return fallback;
  const slug = slugifyName(value);
  if (slug) return slug;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function buildSlug(fileName: string, rid: string): string {
  const baseName = (() => {
    if (fileName) {
      const withoutExt = fileName.replace(/\.[^.]+$/, '');
      const slug = slugifyName(withoutExt);
      if (slug) return slug;
    }
    return '';
  })();
  if (baseName) {
    return baseName;
  }
  if (rid) {
    const slug = slugifyName(rid);
    if (slug) {
      return slug;
    }
  }
  return 'upload';
}

function respondJson(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  status: number,
  payload: Record<string, unknown>,
): void {
  applyUploadCors(req, res, corsDecision);
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
  try {
    res.setHeader('X-Upload-Diag-Id', diagId);
  } catch {}

  const corsDecision = applyUploadCors(req, res, ensureCors(req, res));
  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if ((req.method || '').toUpperCase() !== 'POST') {
    respondJson(req, res, corsDecision, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  let body: NormalizedBody = {};
  try {
    body = await readJsonBody(req);
  } catch (error) {
    logger.warn('upload-original start body_parse_failed', { diagId, message: (error as Error)?.message || error });
    body = {};
  }

  const { ext, source: extSource } = inferExtension({ body, req });
  const allowed = resolveAllowedExtensions();

  if (!ext || !isValidExtension(ext)) {
    respondJson(req, res, corsDecision, 415, {
      ok: false,
      code: 'ext_unsupported',
      allowed,
      diagId,
    });
    return;
  }

  const fileName = extractFileName(body, req);
  const rid = resolveRid(body, req, diagId);
  const safeRid = sanitizeSegment(rid, sanitizeSegment(diagId, 'flow'));
  const slug = buildSlug(fileName, safeRid);
  const objectKey = ['originals', safeRid, `${slug}.${ext}`]
    .filter(Boolean)
    .join('/');
  const expiresIn = resolveExpirySeconds();

  const declaredMime = pickFirstString(
    body.mime,
    body.mime_type,
    body.contentType,
    body.content_type,
    body.file_content_type,
    body.fileMime,
    body.file_mime,
    body.expectedMime,
    body.expected_mime,
  );
  const expectedMime = resolveMime(ext, declaredMime);

  logger.info('upload-original start', {
    diagId,
    rid,
    fileName: fileName || null,
    contentType: expectedMime,
    expectedMime,
    ext,
    extSource,
    objectKey,
  });

  const storageKey = objectKey.replace(/^uploads\//i, '');

  try {

    const storage = supa.storage.from(UPLOAD_BUCKET);
    const { data: signed, error } = await storage.createSignedUploadUrl(storageKey, expiresIn, {
      upsert: true,
      contentType: expectedMime,
    });

    if (error || !signed) {
      logger.error('upload-original signed_upload_failed', {
        diagId,
        rid,
        objectKey,
        storageKey,
        message: error?.message || null,
        status: error?.status || error?.statusCode || null,
      });
      respondJson(req, res, corsDecision, 500, {
        ok: false,
        error: 'signed_upload_unavailable',
        diagId,
      });
      return;
    }

    const directUrl = buildDirectUploadUrl(storageKey);
    const publicUrl = buildPublicUrl(storageKey);
    const uploadHeaders = signed.token
      ? { Authorization: `Bearer ${signed.token}` }
      : undefined;

    const absoluteSignedUrl = (() => {
      const rawSignedUrl = signed.signedUrl ?? '';
      if (!rawSignedUrl) return null;
      if (/^https?:\/\//i.test(rawSignedUrl)) {
        return rawSignedUrl;
      }
      const base = buildBaseUrl();
      if (!base) return rawSignedUrl.startsWith('/') ? rawSignedUrl : `/${rawSignedUrl}`;
      return `${base}${rawSignedUrl.startsWith('/') ? '' : '/'}${rawSignedUrl}`;
    })();

    respondJson(req, res, corsDecision, 200, {
      ok: true,
      uploadUrl: directUrl,
      uploadMethod: 'PUT',
      method: 'PUT',
      objectKey,
      object_key: objectKey,
      path: objectKey,
      bucket: UPLOAD_BUCKET,
      originalObjectKey: objectKey,
      contentType: expectedMime,
      content_type: expectedMime,
      mime: expectedMime,
      expectedMime,
      expected_mime: expectedMime,
      diagId,
      rid,
      publicUrl,
      uploadHeaders,
      upload: {
        url: directUrl,
        method: 'PUT',
        headers: uploadHeaders,
        contentType: expectedMime,
        expected_mime: expectedMime,
        expectedMime,
        objectKey,
        storageKey,
        bucket: UPLOAD_BUCKET,
        signedUrl: absoluteSignedUrl,
        token: signed.token ?? null,
        expiresIn,
      },
      signedUrl: absoluteSignedUrl,
      token: signed.token ?? null,
      expiresIn,
    });
  } catch (error) {
    logger.error('upload-original start exception', {
      diagId,
      rid,
      objectKey,
      storageKey,
      message: (error as Error)?.message || error,
    });
    respondJson(req, res, corsDecision, 500, {
      ok: false,
      error: 'upload_unavailable',
      diagId,
    });
  }
}
