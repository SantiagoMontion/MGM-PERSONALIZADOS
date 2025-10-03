import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';

import { applyCors, ensureJsonContentType } from './_lib/cors';

export const config = { memory: 512, maxDuration: 45 };

type SuccessResponse =
  | { ok: true; mode: 'passthrough'; publicUrl: string }
  | { ok: true; mode: 'url'; publicUrl: string }
  | { ok: true; mode: 'supabase'; publicUrl: string; key: string };

type ErrorResponse = { ok: false; error: string; diagId?: string };

type RequestBody = {
  url?: unknown;
  imageBase64?: unknown;
};

function sendJson(res: VercelResponse, status: number, body: SuccessResponse | ErrorResponse) {
  ensureJsonContentType(res);
  res.status(status).send(JSON.stringify(body));
}

function makeDiagId() {
  return randomBytes(4).toString('hex');
}

function normalizeBody(raw: unknown): RequestBody | null {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return normalizeBody(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as RequestBody;
  }
  return null;
}

function resolveImageInfo(imageBase64: string) {
  let base64Part = imageBase64;
  let mime = 'image/png';

  const dataUrlMatch = /^data:([^;,]+);base64,/i.exec(imageBase64);
  if (dataUrlMatch) {
    mime = dataUrlMatch[1].toLowerCase();
    base64Part = imageBase64.slice(dataUrlMatch[0].length);
  }

  const inferredMime = inferMime(mime);
  return {
    buffer: Buffer.from(base64Part, 'base64'),
    mime: inferredMime.mime,
    ext: inferredMime.ext,
  };
}

function inferMime(inputMime: string) {
  const normalized = inputMime.toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
    case 'image/jpg':
      return { mime: 'image/jpeg', ext: 'jpg' };
    case 'image/webp':
      return { mime: 'image/webp', ext: 'webp' };
    case 'image/gif':
      return { mime: 'image/gif', ext: 'gif' };
    case 'image/png':
    default:
      return { mime: 'image/png', ext: 'png' };
  }
}

function generateKey(ext: string) {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const random = randomBytes(6).toString('hex');
  return `orig/${stamp}-${random}.${ext}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const normalized = normalizeBody(req.body);
  if (normalized === null) {
    return sendJson(res, 400, { ok: false, error: 'invalid_json_body' });
  }

  const { url, imageBase64 } = normalized;

  if (process.env.UPLOAD_ENABLED !== '1') {
    if (typeof url !== 'string' || !url) {
      return sendJson(res, 400, { ok: false, error: 'missing_url' });
    }

    return sendJson(res, 200, {
      ok: true,
      mode: 'passthrough',
      publicUrl: url,
    });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return sendJson(res, 500, {
      ok: false,
      error: 'supabase_not_configured',
    });
  }

  if (typeof url === 'string' && url && (imageBase64 == null || imageBase64 === '')) {
    return sendJson(res, 200, { ok: true, mode: 'url', publicUrl: url });
  }

  if (typeof imageBase64 !== 'string' || !imageBase64) {
    return sendJson(res, 400, {
      ok: false,
      error: 'missing_image_data',
    });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { buffer, mime, ext } = resolveImageInfo(imageBase64);
    const key = generateKey(ext);

    const uploadResult = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(key, buffer, {
        contentType: mime,
        upsert: false,
      });

    if (uploadResult.error) {
      throw uploadResult.error;
    }

    const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(key);
    const publicUrl = publicData.publicUrl;

    return sendJson(res, 200, {
      ok: true,
      mode: 'supabase',
      publicUrl,
      key,
    });
  } catch (error: any) {
    const diagId = makeDiagId();
    console.error(`upload-original failure ${diagId}`, error);
    applyCors(req, res);
    return sendJson(res, 500, {
      ok: false,
      error: error?.message || 'upload_failed',
      diagId,
    });
  }
}
