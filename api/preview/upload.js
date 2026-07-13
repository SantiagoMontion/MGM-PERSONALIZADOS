import { createHash, randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import logger from '../../lib/_lib/logger.js';
import { slugifyName } from '../../lib/_lib/slug.js';

/** Hasta el tope de Vercel (~4.5mb). Payloads más grandes deben comprimirse en el cliente. */
export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };

function parseDataUrl(dataUrl = '') {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { contentType: 'image/png', buffer: null };
  const contentType = match[1] || 'image/png';
  const buffer = Buffer.from(match[2], 'base64');
  return { contentType, buffer };
}

function extensionForContentType(contentType = '') {
  const value = String(contentType || '').toLowerCase();
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg';
  if (value.includes('webp')) return 'webp';
  return 'png';
}

function sanitizeMaterial(material) {
  const value = (material ?? '').toString().trim();
  if (!value) return 'material';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').slice(0, 64);
}

function safeNumberSegment(value) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) {
    return String(Math.round(num));
  }
  return 'NA';
}

export function stableMockupKey(meta = {}, pngBytes = Buffer.alloc(0), contentType = 'image/png') {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const slug = slugifyName(meta?.title || '') || 'personalizado';
  const widthSegment = safeNumberSegment(meta?.widthCm);
  const heightSegment = safeNumberSegment(meta?.heightCm);
  const materialSegment = slugifyName(sanitizeMaterial(meta?.material)) || sanitizeMaterial(meta?.material);
  const hash8 = createHash('sha1').update(pngBytes).digest('hex').slice(0, 8);
  const ext = extensionForContentType(contentType);
  return {
    key: `mockups-${yyyy}-${mm}/${slug}-${widthSegment}x${heightSegment}-${materialSegment}-${hash8}.${ext}`,
    hash8,
  };
}

function sendJson(res, status, payload) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  const diagId = randomUUID();
  const decision = ensureCors(req, res);
  if (!decision?.allowed) {
    respondCorsDenied(req, res, decision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  try {
    const { title, widthCm, heightCm, material, dataUrl } = req.body || {};

    if (typeof dataUrl !== 'string' || dataUrl.length < 32) {
      sendJson(res, 400, { ok: false, error: 'data_url_required', diagId });
      return;
    }

    const { contentType, buffer } = parseDataUrl(dataUrl);
    if (!buffer) {
      sendJson(res, 400, { ok: false, error: 'data_url_invalid', diagId });
      return;
    }

    const supabase = getSupabaseAdmin();
    const bucket = 'preview';
    const uploadContentType = contentType || 'image/png';
    const { key, hash8 } = stableMockupKey({ title, widthCm, heightCm, material }, buffer, uploadContentType);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(key, buffer, {
        upsert: true,
        contentType: uploadContentType,
        cacheControl: '31536000',
      });

    if (uploadError) {
      logger.warn('[preview:upload:error]', {
        diagId,
        bucket,
        key,
        error: uploadError.message,
      });
      sendJson(res, 500, { ok: false, code: 'upload_failed', detail: uploadError.message, diagId });
      return;
    }

    const { data: publicData, error: publicError } = supabase.storage
      .from(bucket)
      .getPublicUrl(key);

    if (publicError) {
      logger.warn('[preview:upload:public_url_failed]', { diagId, bucket, key, error: publicError.message });
      sendJson(res, 500, { ok: false, code: 'upload_failed', detail: publicError.message, diagId });
      return;
    }

    const publicUrl = publicData?.publicUrl || null;
    if (!publicUrl) {
      logger.warn('[preview:upload:public_url_missing]', { diagId, bucket, key });
      sendJson(res, 500, { ok: false, code: 'upload_failed', detail: 'public_url_missing', diagId });
      return;
    }

    let head;
    try {
      head = await fetch(publicUrl, { method: 'HEAD' });
    } catch (headErr) {
      logger.warn('[preview:upload:mockup_head_failed]', {
        diagId,
        bucket,
        key,
        error: headErr?.message || headErr,
      });
      sendJson(res, 502, { ok: false, code: 'mockup_not_ready', diagId });
      return;
    }
    const size = Number(head.headers.get('content-length') || '0');
    if (!head.ok || !Number.isFinite(size) || size < 1024) {
      logger.warn('[preview:upload:mockup_not_ready]', { diagId, bucket, key, status: head.status, size });
      sendJson(res, 502, { ok: false, code: 'mockup_not_ready', diagId });
      return;
    }

    logger.info('[preview:upload:done]', {
      diagId,
      bucket,
      key,
      size: buffer.length,
      contentType: uploadContentType,
    });

    sendJson(res, 200, { ok: true, publicUrl, hash8, objectKey: key, diagId });
  } catch (err) {
    logger.error('[preview:upload:exception]', {
      diagId,
      err: err?.message || err,
    });
    sendJson(res, 500, { ok: false, code: 'upload_failed', detail: err?.message || 'internal_error', diagId });
  }
}
