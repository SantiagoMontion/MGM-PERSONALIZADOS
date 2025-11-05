import { createHash, randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import logger from '../../lib/_lib/logger.js';

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } };

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 96);
}

export function stableMockupKey({ title, widthCm, heightCm, material }, pngBytes) {
  const hash8 = createHash('sha1').update(pngBytes).digest('hex').slice(0, 8);
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const safeTitle = slug(title || 'mockup');
  const w = Number.isFinite(Number(widthCm)) && Number(widthCm) > 0
    ? Math.round(Number(widthCm))
    : 0;
  const h = Number.isFinite(Number(heightCm)) && Number(heightCm) > 0
    ? Math.round(Number(heightCm))
    : 0;
  const materialLabel = String(material || '').trim() || 'Unknown';
  const sizeLabel = `${w}x${h}`;
  const key = `mockups-${yyyy}-${mm}/${safeTitle || 'mockup'} ${sizeLabel} ${materialLabel} ${hash8}.png`;
  return { key, hash8 };
}

function parseDataUrl(dataUrl = '') {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { contentType: 'image/png', buffer: null };
  const contentType = match[1] || 'image/png';
  const buffer = Buffer.from(match[2], 'base64');
  return { contentType, buffer };
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
    sendJson(res, 405, { ok: false, code: 'method_not_allowed', diagId });
    return;
  }

  try {
    const {
      dataUrl,
      title,
      widthCm,
      heightCm,
      material,
    } = req.body || {};

    if (typeof dataUrl !== 'string' || dataUrl.length < 32) {
      sendJson(res, 400, { ok: false, code: 'data_url_required', diagId });
      return;
    }

    const { buffer } = parseDataUrl(dataUrl);
    if (!buffer) {
      sendJson(res, 400, { ok: false, code: 'data_url_invalid', diagId });
      return;
    }

    const { key, hash8 } = stableMockupKey(
      { title, widthCm, heightCm, material },
      buffer,
    );

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .storage.from('preview')
      .upload(key, buffer, {
        upsert: true,
        contentType: 'image/png',
        cacheControl: '31536000',
      });

    if (error) {
      logger.warn('[preview:upload:error]', {
        diagId,
        key,
        error: error.message,
      });
      return res
        .status(500)
        .json({ ok: false, code: 'upload_failed', detail: error.message });
    }

    const publicUrl = supabase.storage.from('preview').getPublicUrl(key).data?.publicUrl;

    if (!publicUrl) {
      logger.error('[preview:upload:public_url_failed]', { diagId, key });
      return res.status(500).json({ ok: false, code: 'public_url_failed' });
    }

    const head = await fetch(publicUrl, { method: 'HEAD' });
    const contentLengthHeader = head.headers?.get('content-length')
      ?? head.headers?.get('Content-Length')
      ?? '0';
    const contentLength = Number(contentLengthHeader);
    if (!head.ok || Number.isNaN(contentLength) || contentLength < 1024) {
      logger.warn('[preview:upload:mockup_not_ready]', {
        diagId,
        key,
        status: head.status,
        contentLength,
      });
      return res.status(502).json({ ok: false, code: 'mockup_not_ready' });
    }

    logger.info('[preview:upload:done]', {
      diagId,
      key,
      size: buffer.length,
      data: Boolean(data),
    });

    return res.json({ ok: true, publicUrl, hash8 });
  } catch (err) {
    logger.error('[preview:upload:exception]', {
      diagId,
      err: err?.message || err,
    });
    return res.status(500).json({ ok: false, code: 'internal_error' });
  }
}
