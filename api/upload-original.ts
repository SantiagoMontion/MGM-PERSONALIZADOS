import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';

const ALLOWED_ORIGINS = new Set<`https://${string}` | `http://${string}`>([
  'https://tu-mousepad-personalizado.mgmgamers.store',
  'http://localhost:5173',
]);

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

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin as string | undefined;
  if (origin && ALLOWED_ORIGINS.has(origin as any)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'null');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

function sendJson(
  req: VercelRequest,
  res: VercelResponse,
  status: number,
  body: SuccessResponse | ErrorResponse,
) {
  applyCors(req, res);
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

  if (!req.headers.origin || !ALLOWED_ORIGINS.has(req.headers.origin as any)) {
    return sendJson(req, res, 403, { ok: false, error: 'Origin not allowed' });
  }

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(req, res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  const normalized = normalizeBody(req.body);
  if (normalized === null) {
    return sendJson(req, res, 400, { ok: false, error: 'Invalid JSON body' });
  }

  const { url, imageBase64 } = normalized;

  if (process.env.UPLOAD_ENABLED !== '1') {
    if (typeof url !== 'string' || !url) {
      return sendJson(req, res, 400, { ok: false, error: 'Missing url' });
    }

    return sendJson(req, res, 200, {
      ok: true,
      mode: 'passthrough',
      publicUrl: url,
    });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return sendJson(req, res, 500, {
      ok: false,
      error: 'Supabase not configured (set UPLOAD_ENABLED to 0 or add credentials)',
    });
  }

  if (typeof url === 'string' && url && (imageBase64 == null || imageBase64 === '')) {
    return sendJson(req, res, 200, { ok: true, mode: 'url', publicUrl: url });
  }

  if (typeof imageBase64 !== 'string' || !imageBase64) {
    return sendJson(req, res, 400, {
      ok: false,
      error: 'Missing image data (imageBase64 or url required)',
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

    return sendJson(req, res, 200, {
      ok: true,
      mode: 'supabase',
      publicUrl,
      key,
    });
  } catch (error: any) {
    const diagId = makeDiagId();
    console.error(`upload-original failure ${diagId}`, error);
    return sendJson(req, res, 500, {
      ok: false,
      error: error?.message || 'Upload failed',
      diagId,
    });
  }
}
