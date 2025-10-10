import { randomUUID } from 'node:crypto';
import { supa } from '../supa.js';
import { buildObjectKey } from '../_lib/slug.js';
import logger from '../_lib/logger.js';

const UPLOAD_BUCKET = 'uploads';
const SIGNED_URL_TTL = 3600;

function toObject(input) {
  if (input && typeof input === 'object') return input;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      return {};
    }
  }
  return {};
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (!match) return null;
  const [, mime, b64] = match;
  try {
    const buffer = Buffer.from(b64, 'base64');
    return { buffer, contentType: mime, size: buffer.length };
  } catch {
    return null;
  }
}

function parseBase64(value, fallbackContentType) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const buffer = Buffer.from(trimmed, 'base64');
    return {
      buffer,
      contentType: fallbackContentType || 'application/octet-stream',
      size: buffer.length,
    };
  } catch {
    return null;
  }
}

function inferExtension({ ext, filename, contentType }) {
  const normalizedExt = typeof ext === 'string' ? ext.trim().toLowerCase() : '';
  if (/^[a-z0-9]{1,10}$/i.test(normalizedExt)) return normalizedExt;
  if (typeof filename === 'string') {
    const match = /\.([a-z0-9]{1,10})$/i.exec(filename.trim());
    if (match) return match[1].toLowerCase();
  }
  if (typeof contentType === 'string') {
    if (contentType === 'image/png') return 'png';
    if (contentType === 'image/jpeg' || contentType === 'image/jpg') return 'jpg';
    if (contentType === 'image/webp') return 'webp';
    if (contentType === 'application/pdf') return 'pdf';
  }
  return 'bin';
}

export default async function uploadOriginal(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, error: 'method_not_allowed' });
  }

  let payload = toObject(req.body);
  if (!Object.keys(payload).length) {
    try {
      const raw = await readRawBody(req);
      payload = toObject(raw);
    } catch (err) {
      logger.error('upload-original read_body', { diagId, error: err?.message || err });
      return res.status(400).json({ ok: false, diag_id: diagId, error: 'invalid_body' });
    }
  }

  const {
    design_name,
    designName,
    material,
    w_cm,
    width_cm,
    h_cm,
    height_cm,
    size_bytes,
    sizeBytes,
    file_size,
    fileSize,
    mime,
    mime_type,
    content_type,
    file_content_type,
    fileContentType,
    file_mime,
    fileMime,
    data_url,
    file_base64,
    base64,
    filename,
    file_name,
    fileName,
    ext,
    sha256,
    file_buffer,
    fileBuffer,
    file,
  } = payload;

  const normalizedName = typeof design_name === 'string' && design_name.trim()
    ? design_name.trim()
    : typeof designName === 'string' && designName.trim()
      ? designName.trim()
      : '';

  const materialValue = typeof material === 'string' ? material : '';
  const widthValue = Number.isFinite(Number(w_cm)) ? Number(w_cm) : Number(width_cm);
  const heightValue = Number.isFinite(Number(h_cm)) ? Number(h_cm) : Number(height_cm);
  const sizeCandidates = [size_bytes, sizeBytes, file_size, fileSize, file?.size, payload?.file?.size];
  let declaredSize = 0;
  for (const candidate of sizeCandidates) {
    const parsedSize = Number(candidate);
    if (Number.isFinite(parsedSize) && parsedSize > 0) {
      declaredSize = parsedSize;
      break;
    }
  }
  const declaredContentType = (() => {
    const candidates = [
      mime,
      mime_type,
      content_type,
      file_content_type,
      fileContentType,
      file_mime,
      fileMime,
      file?.contentType,
      payload?.file?.contentType,
      file?.type,
      payload?.file?.type,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return undefined;
  })();

  const sha = typeof sha256 === 'string' ? sha256.trim().toLowerCase() : '';

  if (!normalizedName) {
    return res.status(400).json({ ok: false, diag_id: diagId, error: 'design_name_required' });
  }
  if (!materialValue) {
    return res.status(400).json({ ok: false, diag_id: diagId, error: 'material_required' });
  }
  if (!Number.isFinite(widthValue) || widthValue <= 0) {
    return res.status(400).json({ ok: false, diag_id: diagId, error: 'width_invalid' });
  }
  if (!Number.isFinite(heightValue) || heightValue <= 0) {
    return res.status(400).json({ ok: false, diag_id: diagId, error: 'height_invalid' });
  }
  if (!sha || !/^[a-f0-9]{64}$/.test(sha)) {
    return res.status(400).json({ ok: false, diag_id: diagId, error: 'sha256_invalid' });
  }

  let parsed = parseDataUrl(data_url);
  if (!parsed) {
    parsed = parseBase64(file_base64 || base64, declaredContentType);
  }

  if (!parsed || !parsed.buffer?.length) {
    const directBuffer = (() => {
      if (file_buffer && Buffer.isBuffer(file_buffer) && file_buffer.length) {
        return file_buffer;
      }
      if (fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length) {
        return fileBuffer;
      }
      if (file && typeof file === 'object' && Buffer.isBuffer(file.buffer) && file.buffer.length) {
        return file.buffer;
      }
      if (payload?.file && typeof payload.file === 'object' && Buffer.isBuffer(payload.file.buffer) && payload.file.buffer.length) {
        return payload.file.buffer;
      }
      return null;
    })();

    if (directBuffer) {
      parsed = {
        buffer: directBuffer,
        size: directBuffer.length,
        contentType: declaredContentType || undefined,
      };
    }
  }

  if (!parsed || !parsed.buffer?.length) {
    return res.status(400).json({ ok: false, diag_id: diagId, error: 'file_missing' });
  }

  const { buffer, size, contentType: rawContentType } = parsed;
  const contentType = declaredContentType || rawContentType || 'application/octet-stream';

  if (declaredSize && declaredSize > 0 && size !== declaredSize) {
    logger.warn('upload-original size_mismatch', {
      diagId,
      declaredSize,
      actualSize: size,
    });
  }

  const filenameCandidates = [filename, file_name, fileName, file?.name, payload?.file?.name];
  let inferredFilename = '';
  for (const candidate of filenameCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      inferredFilename = candidate.trim();
      break;
    }
  }

  const extension = inferExtension({ ext, filename: inferredFilename || filename, contentType });
  const objectKey = buildObjectKey({
    design_name: normalizedName,
    w_cm: widthValue,
    h_cm: heightValue,
    material: materialValue,
    hash: sha,
    ext: extension,
  });

  logger.debug('upload-original start', {
    diagId,
    bucketName: UPLOAD_BUCKET,
    path: objectKey,
    size,
    type: contentType,
  });

  try {
    const storage = supa.storage.from(UPLOAD_BUCKET);
    const { error } = await storage.upload(objectKey, buffer, {
      cacheControl: '3600',
      contentType,
      upsert: true,
    });
    if (error) {
      logger.error('upload-original supabase', {
        diagId,
        bucketName: UPLOAD_BUCKET,
        path: objectKey,
        size,
        type: contentType,
        status: error?.status || error?.statusCode || null,
        message: error?.message,
        name: error?.name,
      });
      return res.status(500).json({
        ok: false,
        diag_id: diagId,
        error: 'supabase_upload_failed',
        supabase: {
          status: error?.status || error?.statusCode || null,
          message: error?.message,
          name: error?.name,
        },
      });
    }

    const { data: publicData } = storage.getPublicUrl(objectKey);
    let signedUrl = null;
    try {
      const { data: signedData, error: signedErr } = await storage.createSignedUrl(
        objectKey,
        SIGNED_URL_TTL,
      );
      if (!signedErr) {
        signedUrl = signedData?.signedUrl || null;
      }
    } catch (err) {
      logger.warn('upload-original signed_url', { diagId, error: err?.message || err });
    }

    return res.status(200).json({
      ok: true,
      diag_id: diagId,
      bucket: UPLOAD_BUCKET,
      path: objectKey,
      object_key: objectKey,
      size_bytes: size,
      content_type: contentType,
      file_original_url: publicData?.publicUrl || null,
      public_url: publicData?.publicUrl || null,
      signed_url: signedUrl,
      signed_url_expires_in: SIGNED_URL_TTL,
      sha256: sha,
    });
  } catch (err) {
    logger.error('upload-original exception', {
      diagId,
      bucketName: UPLOAD_BUCKET,
      path: objectKey,
      error: err?.message || err,
    });
    return res.status(500).json({ ok: false, diag_id: diagId, error: 'upload_exception' });
  }
}
