import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from './supabaseAdmin.js';
import {
  buildPrintStorageDetails,
  sanitizePdfFilename,
} from './printNaming.js';

const OUTPUT_BUCKET = 'outputs';
const SIGNED_URL_TTL_SECONDS = 600;

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
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error('pdf_save_env_error', { diagId, message: err?.message || err });
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
  console.info('pdf_upload_start', { diagId, bucket: OUTPUT_BUCKET, path, sizeBytes: size });

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  const { error: uploadError } = await storage.upload(path, buffer, {
    upsert: true,
    cacheControl: '3600',
    contentType: 'application/pdf',
    metadata: normalizeMetadata(metadata),
  });
  if (uploadError) {
    console.error('pdf_upload_failure', {
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

  const { data: signedData, error: signedError } = await storage.createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
    download: true,
  });
  if (signedError) {
    console.error('pdf_upload_signed_url_error', {
      diagId,
      path,
      sizeBytes: size,
      status: signedError?.status || signedError?.statusCode || null,
      message: signedError?.message,
      name: signedError?.name,
    });
    const error = new Error('supabase_signed_url_failed');
    error.code = 'supabase_signed_url_failed';
    error.cause = signedError;
    throw error;
  }

  const { data: publicData } = storage.getPublicUrl(path);

  console.info('pdf_upload_ok', { diagId, bucket: OUTPUT_BUCKET, path, sizeBytes: size });

  return {
    path,
    signedUrl: signedData?.signedUrl || null,
    expiresIn: SIGNED_URL_TTL_SECONDS,
    diagId,
    fileName: safeFilename,
    publicUrl: publicData?.publicUrl || null,
  };
}

export default savePrintPdfToSupabase;
