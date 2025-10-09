import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { createDiagId, logApiError } from '../_lib/diag.js';
import {
  applyCorsHeaders,
  ensureCors,
  handlePreflight,
  respondCorsDenied,
  type CorsDecision,
} from '../_lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';

const ALLOWED_METHODS = 'POST, OPTIONS';
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg']);
const DEFAULT_BUCKET = process.env.SUPABASE_DESIGNS_BUCKET || 'designs';
const SIGNED_UPLOAD_TTL_SECONDS = 600;
const MAX_BYTES = 40 * 1024 * 1024;

type SignRequestBody = {
  fileName?: unknown;
  contentType?: unknown;
};

type SignResponsePayload = {
  ok: true;
  diagId: string;
  uploadUrl: string;
  path: string;
  bucket: string;
  publicUrl: string | null;
  maxBytes: number;
};

function ensureJson(req: VercelRequest): Record<string, unknown> | null {
  const body = req.body as unknown;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    return body as Record<string, unknown>;
  }

  const raw = typeof body === 'string'
    ? body
    : typeof body === 'undefined'
      ? undefined
      : Buffer.isBuffer(body)
        ? body.toString('utf8')
        : (req as any).rawBody && typeof (req as any).rawBody === 'string'
          ? (req as any).rawBody
          : null;

  if (typeof raw !== 'string' || !raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeContentType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const base = value.split(';')[0]?.trim().toLowerCase();
  if (!base) return null;
  return base;
}

function resolveExtension(contentType: string, fallbackFileName: string | null): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (fallbackFileName) {
    const match = /\.([a-z0-9]+)$/i.exec(fallbackFileName.trim());
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return 'bin';
}

function buildStoragePath(contentType: string, fileName: string | null): { path: string; relativePath: string } {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const extension = resolveExtension(contentType, fileName);
  const uniqueId = randomUUID();
  const relativePath = `${year}/${month}/${day}/${uniqueId}.${extension}`;
  const fullPath = `${DEFAULT_BUCKET}/${relativePath}`;
  return { path: fullPath, relativePath };
}

function respondJson(
  req: VercelRequest,
  res: VercelResponse,
  decision: CorsDecision,
  status: number,
  payload: Record<string, unknown>,
) {
  applyCorsHeaders(req, res, decision);
  if (typeof res.status === 'function') {
    res.status(status);
    if (typeof res.json === 'function') {
      res.json(payload);
      return;
    }
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = createDiagId();
  res.setHeader('X-Diag-Id', diagId);

  let corsDecision = ensureCors(req, res);
  corsDecision = applyCorsHeaders(req, res, {
    ...corsDecision,
    allowMethods: ALLOWED_METHODS,
  });

  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    respondCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    handlePreflight(req, res, corsDecision);
    return;
  }

  if (req.method !== 'POST') {
    respondJson(req, res, corsDecision, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  try {
    const json = ensureJson(req) as SignRequestBody | null;
    if (!json) {
      respondJson(req, res, corsDecision, 400, { ok: false, error: 'invalid_body', diagId });
      return;
    }

    const fileName = typeof json.fileName === 'string' ? json.fileName : null;
    const contentType = normalizeContentType(json.contentType);
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      respondJson(req, res, corsDecision, 400, { ok: false, error: 'invalid_content_type', diagId });
      return;
    }

    const { path, relativePath } = buildStoragePath(contentType, fileName);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.storage.createSignedUploadUrl(
      DEFAULT_BUCKET,
      relativePath,
      SIGNED_UPLOAD_TTL_SECONDS,
    );

    if (error || !data?.signedUrl) {
      throw error || new Error('signed_url_failed');
    }

    const { data: publicData } = supabase.storage.from(DEFAULT_BUCKET).getPublicUrl(relativePath);
    const payload: SignResponsePayload = {
      ok: true,
      diagId,
      uploadUrl: data.signedUrl,
      path,
      bucket: DEFAULT_BUCKET,
      publicUrl: publicData?.publicUrl ?? null,
      maxBytes: MAX_BYTES,
    };

    respondJson(req, res, corsDecision, 200, payload);
  } catch (error) {
    logApiError('storage.sign', { diagId, error });
    respondJson(req, res, corsDecision, 500, { ok: false, error: 'storage_sign_failed', diagId });
  }
}

