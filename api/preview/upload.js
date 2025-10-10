import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import logger from '../../lib/_lib/logger.js';

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } };

function parseDataUrl(dataUrl = '') {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { contentType: 'image/png', buffer: null };
  const contentType = match[1] || 'image/png';
  const buffer = Buffer.from(match[2], 'base64');
  return { contentType, buffer };
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
    res.status(405).json({ ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  try {
    const { objectKey, dataUrl, contentType: ctOverride } = req.body || {};

    if (typeof objectKey !== 'string' || !objectKey.trim()) {
      res.status(400).json({ ok: false, error: 'object_key_required', diagId });
      return;
    }
    if (typeof dataUrl !== 'string' || dataUrl.length < 32) {
      res.status(400).json({ ok: false, error: 'data_url_required', diagId });
      return;
    }

    const { contentType, buffer } = parseDataUrl(dataUrl);
    if (!buffer) {
      res.status(400).json({ ok: false, error: 'data_url_invalid', diagId });
      return;
    }

    const supabase = getSupabaseAdmin();
    const bucket = 'preview';
    const key = objectKey.trim();

    const uploadResult = await supabase.storage
      .from(bucket)
      .upload(key, buffer, {
        upsert: true,
        contentType: ctOverride || contentType || 'image/png',
        cacheControl: '31536000',
      });

    if (uploadResult.error && !uploadResult.data) {
      logger.warn('[preview:upload:error]', {
        diagId,
        bucket,
        key,
        error: uploadResult.error.message,
      });
    }

    const { data: publicData, error: publicError } = supabase.storage
      .from(bucket)
      .getPublicUrl(key);

    if (publicError) {
      res.status(500).json({ ok: false, error: 'public_url_failed', diagId });
      return;
    }

    logger.info('[preview:upload:done]', {
      diagId,
      bucket,
      key,
      size: buffer.length,
      skipUpload: Boolean(uploadResult.error),
    });

    res.status(200).json({
      ok: true,
      bucket,
      objectKey: key,
      publicUrl: publicData?.publicUrl || null,
      skipUpload: Boolean(uploadResult.error),
      diagId,
    });
  } catch (err) {
    logger.error('[preview:upload:exception]', {
      diagId,
      err: err?.message || err,
    });
    res.status(500).json({ ok: false, error: 'internal_error', diagId });
  }
}
