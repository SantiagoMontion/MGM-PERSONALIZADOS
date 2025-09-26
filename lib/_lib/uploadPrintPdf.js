import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from './supabaseAdmin.js';

const OUTPUT_BUCKET = 'outputs';
const SIGNED_URL_TTL_SECONDS = 86_400; // 24 horas

function ensureFilename(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) {
    return `${randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 12)}.pdf`;
  }
  const lastSegment = raw.split(/[\\/]/).pop() || raw;
  const ensured = lastSegment.endsWith('.pdf') ? lastSegment : `${lastSegment}.pdf`;
  return ensured.replace(/[^a-z0-9._-]+/gi, '-');
}

function buildPdfPath(filename) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `print/${year}/${month}/${filename}`;
}

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

  const safeFilename = ensureFilename(filename);
  const path = buildPdfPath(safeFilename);
  const size = buffer.length;

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  const { error: uploadError } = await storage.upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: true,
    cacheControl: '3600',
    metadata: normalizeMetadata(metadata),
  });

  if (uploadError) {
    console.error('pdf_upload_error', {
      diagId: localDiag,
      path,
      size,
      status: uploadError?.status || uploadError?.statusCode || null,
      message: uploadError?.message,
      name: uploadError?.name,
    });
    const error = new Error('supabase_upload_failed');
    error.code = 'supabase_upload_failed';
    error.cause = uploadError;
    throw error;
  }

  const { data: publicData } = storage.getPublicUrl(path);
  const publicUrl = publicData?.publicUrl || null;

  const { data: signedData, error: signedError } = await storage.createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
    download: safeFilename,
  });

  if (signedError) {
    console.error('pdf_upload_signed_url_error', {
      diagId: localDiag,
      path,
      size,
      status: signedError?.status || signedError?.statusCode || null,
      message: signedError?.message,
      name: signedError?.name,
    });
  }

  return {
    bucket: OUTPUT_BUCKET,
    path,
    publicUrl,
    signedUrl: signedData?.signedUrl || null,
    expiresIn: SIGNED_URL_TTL_SECONDS,
    diagId: localDiag,
  };
}

export default uploadPrintPdf;
