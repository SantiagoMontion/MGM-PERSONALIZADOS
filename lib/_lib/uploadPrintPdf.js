import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from './supabaseAdmin.js';
import {
  buildPrintStorageDetails,
  sanitizePdfFilename,
} from './printNaming.js';

const OUTPUT_BUCKET = 'outputs';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 86_400; // 24 horas
function resolveUploadSignedUrlTtl() {
  const raw = process.env.SIGNED_URL_TTL_SECONDS_UPLOAD;
  if (!raw) return DEFAULT_SIGNED_URL_TTL_SECONDS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  try {
    console.warn?.('prints_upload_ttl_invalid', { raw });
  } catch (err) {
    // noop
  }
  return DEFAULT_SIGNED_URL_TTL_SECONDS;
}
export const SIGNED_URL_TTL_SECONDS = resolveUploadSignedUrlTtl();
const MAX_PDF_BYTES = 150 * 1024 * 1024; // 150 MB hard limit
const MAX_UPLOAD_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 800;

function normalizeMetadata(meta = {}) {
  const base = { createdBy: 'prints-upload', private: 'false' };
  const output = { ...base };
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    if (typeof value === 'boolean') {
      output[key] = value ? 'true' : 'false';
    } else {
      output[key] = typeof value === 'string' ? value : String(value);
    }
  }
  if (!('createdBy' in output)) output.createdBy = 'prints-upload';
  return output;
}

function shouldRetryUpload(error) {
  const status = error?.status || error?.statusCode || error?.originalError?.statusCode || 0;
  return status >= 500 && status < 600;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadPrintPdf({ buffer, filename, metadata = {}, diagId }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('pdf_buffer_empty');
    error.code = 'pdf_buffer_empty';
    throw error;
  }

  const localDiag = diagId || randomUUID();

  const originalName = typeof filename === 'string' ? filename.trim() : '';
  if (originalName && /\.(png|jpe?g)$/i.test(originalName)) {
    console.warn('png_upload_blocked', {
      diagId: localDiag,
      bucket: OUTPUT_BUCKET,
      filename: originalName,
      reason: 'filename_extension',
    });
    const error = new Error('png_upload_blocked');
    error.code = 'png_upload_blocked';
    throw error;
  }

  const header = buffer.subarray(0, 8);
  const isPng = header.length >= 8
    && header[0] === 0x89
    && header[1] === 0x50
    && header[2] === 0x4e
    && header[3] === 0x47;
  const isJpeg = header.length >= 2 && header[0] === 0xff && header[1] === 0xd8;
  if (isPng || isJpeg) {
    console.warn('png_upload_blocked', {
      diagId: localDiag,
      bucket: OUTPUT_BUCKET,
      filename: originalName || null,
      reason: isPng ? 'buffer_png_signature' : 'buffer_jpeg_signature',
    });
    const error = new Error('png_upload_blocked');
    error.code = 'png_upload_blocked';
    throw error;
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error('pdf_upload_env_error', { diagId: localDiag, message: err?.message || err });
    const error = new Error('supabase_credentials_missing');
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

  if (size > MAX_PDF_BYTES) {
    console.error('pdf_upload_too_large', { diagId: localDiag, path, size });
    const error = new Error('pdf_too_large');
    error.code = 'pdf_too_large';
    error.diagId = localDiag;
    throw error;
  }

  const storage = supabase.storage.from(OUTPUT_BUCKET);

  console.info('pdf_upload_start', {
    diagId: localDiag,
    bucket: OUTPUT_BUCKET,
    path,
    sizeBytes: size,
  });

  let uploadError = null;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    const { error } = await storage.upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '3600',
      metadata: normalizeMetadata(metadata),
    });

    if (!error) {
      uploadError = null;
      break;
    }

    uploadError = error;
    const status = error?.status || error?.statusCode || null;
    const retryable = shouldRetryUpload(error) && attempt < MAX_UPLOAD_ATTEMPTS;
    console.error('pdf_upload_error', {
      diagId: localDiag,
      path,
      size,
      attempt,
      status,
      retryable,
      message: error?.message,
      name: error?.name,
    });

    if (retryable) {
      await wait(RETRY_BACKOFF_MS);
      continue;
    }
    break;
  }

  if (uploadError) {
    console.error('pdf_upload_failure', {
      diagId: localDiag,
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
    error.diagId = localDiag;
    throw error;
  }

  const { data: signedData, error: signedError } = await storage.createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
    download: safeFilename,
  });

  if (signedError || !signedData?.signedUrl) {
    console.error('pdf_upload_signed_url_error', {
      diagId: localDiag,
      path,
      size,
      status: signedError?.status || signedError?.statusCode || null,
      message: signedError?.message,
      name: signedError?.name,
    });
    const error = new Error('supabase_signed_url_failed');
    error.code = 'supabase_signed_url_failed';
    error.cause = signedError;
    error.diagId = localDiag;
    throw error;
  }

  const { data: publicData } = storage.getPublicUrl(path);

  console.info('pdf_upload_ok', {
    diagId: localDiag,
    bucket: OUTPUT_BUCKET,
    path,
    sizeBytes: size,
  });

  return {
    bucket: OUTPUT_BUCKET,
    path,
    signedUrl: signedData.signedUrl,
    expiresIn: SIGNED_URL_TTL_SECONDS,
    diagId: localDiag,
    fileName: safeFilename,
    publicUrl: publicData?.publicUrl || null,
  };
}

export default uploadPrintPdf;

