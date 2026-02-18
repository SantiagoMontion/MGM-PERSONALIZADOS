import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from './supabaseAdmin.js';
import {
  buildPrintStorageDetails,
  buildPreviewStorageDetails,
  sanitizePdfFilename,
} from './printNaming.js';
import logger from './logger.js';

const OUTPUT_BUCKET = 'outputs';
const SIGNED_URL_TTL_SECONDS = 600;
const SIGNED_URL_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OBJECT_BYTES = 50 * 1024 * 1024;
const SIGN_TIMEOUT_MS = 8_000;
const SIGN_AFTER_UPLOAD_DELAY_MS = 500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label}_timeout`);
          error.code = `${label}_timeout`;
          error.timeoutMs = timeoutMs;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readMaxObjectBytes() {
  const raw = process.env.SUPABASE_MAX_OBJECT_BYTES;
  if (!raw) return DEFAULT_MAX_OBJECT_BYTES;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_MAX_OBJECT_BYTES;
  return Math.floor(num);
}

function normalizeMetadata(meta = {}) {
  const base = { private: 'true', createdBy: 'editor' };
  const output = { ...base };
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    if (typeof value === 'boolean') {
      output[key] = value ? 'true' : 'false';
    } else {
      output[key] = typeof value === 'string' ? value : String(value);
    }
  }
  if (!('private' in meta)) output.private = 'true';
  if (!('createdBy' in meta)) output.createdBy = 'editor';
  return output;
}

export async function savePrintPdfToSupabase(buffer, filename, metadata = {}) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('pdf_buffer_empty');
    error.code = 'pdf_buffer_empty';
    throw error;
  }

  const diagId = randomUUID();
  const maxObjectBytes = readMaxObjectBytes();
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    logger.error('pdf_save_env_error', { diagId, message: err?.message || err });
    const error = new Error('Faltan credenciales de Supabase');
    error.code = 'supabase_credentials_missing';
    error.cause = err;
    throw error;
  }

  const details = buildPrintStorageDetails({
    slug: metadata.slug ?? metadata.designSlug ?? metadata.slugName ?? metadata.design_name,
    widthCm: metadata.widthCm ?? metadata.width_cm,
    heightCm: metadata.heightCm ?? metadata.height_cm,
    material: metadata.material ?? metadata.mode,
    jobId: metadata.jobId ?? metadata.job_id,
    jobKey: metadata.jobKey,
    fallbackFilename: filename,
  });
  const safeFilename = sanitizePdfFilename(details.filename);
  const path = details.path;
  const size = buffer.length;
  if (size > maxObjectBytes) {
    const error = new Error('supabase_object_too_large');
    error.code = 'supabase_object_too_large';
    error.limit = maxObjectBytes;
    error.size = size;
    logger.error('pdf_upload_too_large', { diagId, bucket: OUTPUT_BUCKET, path, sizeBytes: size, limit: maxObjectBytes });
    throw error;
  }
  logger.debug('pdf_upload_start', { diagId, bucket: OUTPUT_BUCKET, path, sizeBytes: size });

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  const { error: uploadError } = await storage.upload(path, buffer, {
    upsert: true,
    cacheControl: '3600',
    contentType: 'application/pdf',
    metadata: normalizeMetadata(metadata),
  });
  if (uploadError) {
    logger.error('pdf_upload_failure', {
      diagId,
      bucket: OUTPUT_BUCKET,
      path,
      sizeBytes: size,
      status: uploadError?.status || uploadError?.statusCode || null,
      message: uploadError?.message,
      name: uploadError?.name,
    });
    const error = new Error('supabase_upload_failed');
    error.code = 'supabase_upload_failed';
    error.cause = uploadError;
    throw error;
  }

  await delay(SIGN_AFTER_UPLOAD_DELAY_MS);

  let signedData = null;
  let signedError = null;
  try {
    const signedResult = await withTimeout(
      storage.createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
        download: true,
      }),
      SIGN_TIMEOUT_MS,
      'supabase_signed_url',
    );
    signedData = signedResult?.data || null;
    signedError = signedResult?.error || null;
  } catch (err) {
    signedError = err;
  }

  const { data: publicData } = storage.getPublicUrl(path);
  const publicUrl = publicData?.publicUrl || null;
  const resolvedSignedUrl = signedData?.signedUrl || publicUrl;

  if (signedError || !signedData?.signedUrl) {
    logger.warn('pdf_upload_signed_url_fallback_public', {
      diagId,
      path,
      sizeBytes: size,
      status: signedError?.status || signedError?.statusCode || null,
      message: signedError?.message || 'missing_signed_url',
      name: signedError?.name,
      timeoutMs: signedError?.timeoutMs || null,
      fallback: Boolean(publicUrl),
    });
  }

  logger.debug('pdf_upload_ok', { diagId, bucket: OUTPUT_BUCKET, path, sizeBytes: size, usedPublicUrlFallback: resolvedSignedUrl === publicUrl });

  return {
    path,
    signedUrl: resolvedSignedUrl,
    expiresIn: SIGNED_URL_TTL_SECONDS,
    diagId,
    fileName: safeFilename,
    publicUrl,
  };
}

export default savePrintPdfToSupabase;

export async function savePrintPreviewToSupabase(buffer, filename, metadata = {}) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('preview_buffer_empty');
    error.code = 'preview_buffer_empty';
    throw error;
  }

  const diagId = randomUUID();
  const maxObjectBytes = readMaxObjectBytes();
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    logger.error('preview_save_env_error', { diagId, message: err?.message || err });
    const error = new Error('Faltan credenciales de Supabase');
    error.code = 'supabase_credentials_missing';
    error.cause = err;
    throw error;
  }

  const details = buildPreviewStorageDetails({
    slug: metadata.slug ?? metadata.designSlug ?? metadata.slugName ?? metadata.design_name,
    widthCm: metadata.widthCm ?? metadata.width_cm,
    heightCm: metadata.heightCm ?? metadata.height_cm,
    material: metadata.material ?? metadata.mode,
    jobId: metadata.jobId ?? metadata.job_id,
    jobKey: metadata.jobKey,
    fallbackFilename: filename,
  });
  const safeFilename = details.filename;
  const path = details.path;
  const size = buffer.length;
  if (size > maxObjectBytes) {
    const error = new Error('supabase_object_too_large');
    error.code = 'supabase_object_too_large';
    error.limit = maxObjectBytes;
    error.size = size;
    logger.error('preview_store_too_large', { diagId, bucket: OUTPUT_BUCKET, path, sizeBytes: size, limit: maxObjectBytes });
    throw error;
  }
  logger.debug('preview_store_start', { diagId, bucket: OUTPUT_BUCKET, path, sizeBytes: size });

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  const { error: uploadError } = await storage.upload(path, buffer, {
    upsert: true,
    cacheControl: '3600',
    contentType: 'image/jpeg',
    metadata: normalizeMetadata({ ...metadata, assetType: 'preview_image' }),
  });
  if (uploadError) {
    logger.error('preview_store_failure', {
      diagId,
      bucket: OUTPUT_BUCKET,
      path,
      sizeBytes: size,
      status: uploadError?.status || uploadError?.statusCode || null,
      message: uploadError?.message,
      name: uploadError?.name,
    });
    const error = new Error('supabase_upload_failed');
    error.code = 'supabase_upload_failed';
    error.cause = uploadError;
    throw error;
  }

  logger.debug('preview_store_ok', { diagId, bucket: OUTPUT_BUCKET, path, sizeBytes: size });
  return { path, fileName: safeFilename };
}
