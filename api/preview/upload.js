import { createHash, randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import logger from '../../lib/_lib/logger.js';
import { slugifyName } from '../../lib/_lib/slug.js';

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } };

function parseDataUrl(dataUrl = '') {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { contentType: 'image/png', buffer: null };
  const contentType = match[1] || 'image/png';
  const buffer = Buffer.from(match[2], 'base64');
  return { contentType, buffer };
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

export function stableMockupKey(meta = {}, pngBytes = Buffer.alloc(0)) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const slug = slugifyName(meta?.title || '') || 'personalizado';
  const widthSegment = safeNumberSegment(meta?.widthCm);
  const heightSegment = safeNumberSegment(meta?.heightCm);
  const materialSegment = slugifyName(sanitizeMaterial(meta?.material)) || sanitizeMaterial(meta?.material);
  const hash8 = createHash('sha1').update(pngBytes).digest('hex').slice(0, 8);
  return {
    key: `mockups-${yyyy}-${mm}/${slug}-${widthSegment}x${heightSegment}-${materialSegment}-${hash8}.png`,
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

  res.setHeader?.('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader?.('Access-Control-Allow-Headers', 'content-type,authorization,x-upsert');
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
    const { key, hash8 } = stableMockupKey({ title, widthCm, heightCm, material }, buffer);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(key, buffer, {
        upsert: true,
        contentType: 'image/png',
        cacheControl: '31536000',
      });

    if (uploadError) {
      logger.warn('[preview:upload:error]', {
        diagId,
        bucket,
        key,
        error: uploadError.message,
      });
      res.status(500).json({ ok: false, code: 'upload_failed', detail: uploadError.message });
      return;
    }

    const { data: publicData, error: publicError } = supabase.storage
      .from(bucket)
      .getPublicUrl(key);

    if (publicError) {
      logger.warn('[preview:upload:public_url_failed]', { diagId, bucket, key, error: publicError.message });
      res.status(500).json({ ok: false, code: 'upload_failed', detail: publicError.message });
      return;
    }

    const publicUrl = publicData?.publicUrl || null;
    if (!publicUrl) {
      logger.warn('[preview:upload:public_url_missing]', { diagId, bucket, key });
      res.status(500).json({ ok: false, code: 'upload_failed', detail: 'public_url_missing' });
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
      res.status(502).json({ ok: false, code: 'mockup_not_ready' });
      return;
    }
    const size = Number(head.headers.get('content-length') || '0');
    if (!head.ok || !Number.isFinite(size) || size < 1024) {
      logger.warn('[preview:upload:mockup_not_ready]', { diagId, bucket, key, status: head.status, size });
      res.status(502).json({ ok: false, code: 'mockup_not_ready' });
      return;
    }

    logger.info('[preview:upload:done]', {
      diagId,
      bucket,
      key,
      size: buffer.length,
    });

    res.json({ ok: true, publicUrl, hash8 });
  } catch (err) {
    logger.error('[preview:upload:exception]', {
      diagId,
      err: err?.message || err,
    });
    res.status(500).json({ ok: false, code: 'upload_failed', detail: err?.message || 'internal_error' });
  }
}
