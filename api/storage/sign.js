import { randomUUID } from 'node:crypto';
import { ensureCors, respondCorsDenied } from '../../lib/cors.js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';

const ALLOWED_BUCKETS = new Set(['outputs', 'preview', 'uploads']);
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_EXPIRES = 900;

export default async function handler(req, res) {
  const diagId = randomUUID();
  const decision = ensureCors(req, res);
  if (!decision?.allowed || !decision?.allowedOrigin) {
    respondCorsDenied(req, res, decision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST, OPTIONS');
    res.status(405).json({ ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== 'object') {
      body = {};
    }

    const bucketRaw = typeof body.bucket === 'string' ? body.bucket.trim() : DEFAULT_BUCKET;
    const requestedBucket = ALLOWED_BUCKETS.has(bucketRaw) ? bucketRaw : DEFAULT_BUCKET;

    const contentType = typeof body.contentType === 'string' && body.contentType.trim()
      ? body.contentType.trim()
      : '';
    if (!contentType) {
      res.status(400).json({ ok: false, error: 'content_type_required', diagId });
      return;
    }

    const expiresInRaw = Number.isFinite(Number(body.expiresIn)) && Number(body.expiresIn) > 0
      ? Math.min(Math.round(Number(body.expiresIn)), 60 * 60 * 24)
      : DEFAULT_EXPIRES;

    const extension = (() => {
      if (/pdf/i.test(contentType)) return '.pdf';
      if (/png/i.test(contentType)) return '.png';
      if (/jpe?g/i.test(contentType)) return '.jpg';
      return '';
    })();
    const objectKey = typeof body.path === 'string' && body.path.trim()
      ? body.path.trim()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;

    const supabase = getSupabaseAdmin();

    const ensureBucketExists = async (bucketName) => {
      try {
        const { data: bucketInfo } = await supabase.storage.getBucket(bucketName);
        if (!bucketInfo) {
          const { error: createError } = await supabase.storage.createBucket(bucketName, {
            public: bucketName !== 'uploads',
          });
          if (createError) {
            return createError;
          }
        }
        return null;
      } catch (error) {
        return error;
      }
    };

    const signInBucket = async (bucketName) => {
      const ensureError = await ensureBucketExists(bucketName);
      if (ensureError) {
        return { error: ensureError };
      }
      const { data, error } = await supabase
        .storage
        .from(bucketName)
        .createSignedUploadUrl(objectKey, expiresInRaw);
      if (error) {
        return { error };
      }
      const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(objectKey);
      return { data, publicData };
    };

    let bucket = requestedBucket;
    let signResult = await signInBucket(bucket);
    if (signResult.error && bucket !== DEFAULT_BUCKET) {
      console.debug('[sign] retry_default_bucket', {
        diagId,
        requestedBucket,
        bucket,
        objectKey,
        error: signResult.error?.message || signResult.error,
      });
      bucket = DEFAULT_BUCKET;
      signResult = await signInBucket(bucket);
    }

    if (signResult.error || !signResult?.data?.signedUrl || !signResult?.data?.token) {
      const reason = signResult.error?.message || signResult.error || 'missing_signed_url';
      console.debug('[sign] nonfatal_failure', { diagId, bucket, requestedBucket, objectKey, reason });
      res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
      res.status(200).json({
        ok: false,
        error: 'sign_failed',
        diagId,
        requestedBucket,
        usedBucket: bucket,
      });
      return;
    }

    const signedData = signResult.data;
    const publicData = signResult.publicData;

    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      ok: true,
      bucket,
      path: objectKey,
      uploadUrl: signedData?.signedUrl || null,
      publicUrl: publicData?.publicUrl || null,
      expiresIn: expiresInRaw,
      token: signedData?.token || null,
      signedUrl: signedData?.signedUrl || null,
      diagId,
      requestedBucket,
    });
  } catch (err) {
    console.debug('[sign] catch_nonfatal', { diagId, error: err?.message || err });
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      ok: false,
      error: 'internal_error',
      diagId,
    });
  }
}
