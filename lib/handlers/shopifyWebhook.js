import crypto from 'node:crypto';
import { readRequestBody } from '../_lib/http.js';
import imageBufferToPdf from '../_lib/imageToPdf.js';
import logger from '../_lib/logger.js';
import { buildPrintStorageDetails } from '../_lib/printNaming.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

const ALLOWED_TOPICS = new Set(['orders/create', 'orders/paid']);
const HMAC_HEADER = 'x-shopify-hmac-sha256';
const OUTPUT_BUCKET = 'outputs';
const UPLOADS_BUCKET = 'uploads';
const PUBLIC_YEAR_CACHE_CONTROL = 'public, max-age=31536000';
const LOSSLESS_JOB_STATUS = 'LOSSLESS_PDF_READY';
const LOSSLESS_JOB_EVENT = 'lossless_pdf_generated';

function getHeaderValue(req, name) {
  const header = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(header)) return header[0];
  return header;
}

function toTrimmedString(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return null;
}

function findAttribute(collection, key) {
  if (!Array.isArray(collection)) return null;
  const target = String(key || '').toLowerCase();
  for (const entry of collection) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.toLowerCase() : '';
    if (name === target) {
      const value = 'value' in entry ? entry.value : undefined;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
  }
  return null;
}

function findInLineItemProperties(lineItems, key) {
  if (!Array.isArray(lineItems)) return null;
  for (const item of lineItems) {
    if (!item || typeof item !== 'object') continue;
    const match = findAttribute(item.properties, key);
    if (match) return match;
  }
  return null;
}

function findInCustomAttributes(collection, key) {
  if (!Array.isArray(collection)) return null;
  const target = String(key || '').toLowerCase();
  for (const entry of collection) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.key === 'string' ? entry.key.toLowerCase() : typeof entry.name === 'string' ? entry.name.toLowerCase() : '';
    if (name === target) {
      const value = 'value' in entry ? entry.value : undefined;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
  }
  return null;
}

function extractRid(order) {
  const fromLineItem = findInLineItemProperties(order?.line_items, 'rid');
  if (fromLineItem) return fromLineItem;

  const fromNotes = findAttribute(order?.note_attributes, 'rid');
  if (fromNotes) return fromNotes;

  const fromCustomAttrs = findInCustomAttributes(order?.customAttributes || order?.custom_attributes, 'rid')
    || findInCustomAttributes(order?.checkout?.customAttributes, 'rid');
  if (fromCustomAttrs) return fromCustomAttrs;

  const note = typeof order?.note === 'string' ? order.note : '';
  if (note) {
    const match = note.match(/rid=([A-Za-z0-9\-_]+)/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function extractDesignSlug(order) {
  const fromLineItem = findInLineItemProperties(order?.line_items, 'design_slug');
  if (fromLineItem) return fromLineItem;
  return findAttribute(order?.note_attributes, 'design_slug');
}

function extractProductHandle(order) {
  const fromLineItem = findInLineItemProperties(order?.line_items, 'product_handle');
  if (fromLineItem) return fromLineItem;
  const fromNotes = findAttribute(order?.note_attributes, 'product_handle');
  if (fromNotes) return fromNotes;
  const firstLineItem = Array.isArray(order?.line_items) && order.line_items.length ? order.line_items[0] : null;
  if (firstLineItem && typeof firstLineItem.handle === 'string' && firstLineItem.handle.trim()) {
    return firstLineItem.handle.trim();
  }
  const fromCustomAttrs = findInCustomAttributes(order?.customAttributes || order?.custom_attributes, 'product_handle')
    || findInCustomAttributes(order?.checkout?.customAttributes, 'product_handle');
  if (fromCustomAttrs) return fromCustomAttrs;
  return null;
}

function safeCompare(expected, received) {
  const expectedBuf = Buffer.from(expected || '', 'utf8');
  const receivedBuf = Buffer.from(received || '', 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

function safeTrim(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
}

function resolveUploadsObjectKey(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    const match = /storage\/v1\/object\/(?:public\/)?uploads\/(.+)$/i.exec(value);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    return null;
  }

  value = value.replace(/^\/+/, '');
  value = value.replace(/^public\//i, '');
  value = value.replace(/^storage\/v1\/object\//i, '');
  value = value.replace(/^uploads\//i, '');
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function dataToBuffer(data) {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (typeof data.arrayBuffer === 'function') {
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  }
  if (typeof data === 'string') return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.alloc(0);
}

function parseDataUrlBuffer(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (!match) return null;
  try {
    return Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
}

function buildUploadMetadata(meta = {}) {
  const output = { createdBy: 'shopify-webhook', private: 'false', assetType: 'lossless_pdf' };
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    output[key] = typeof value === 'string' ? value : String(value);
  }
  return output;
}

async function fetchOriginalBuffer({ supabaseClient, objectKey, url, diagId, rid, orderId }) {
  const sourceInfo = {};

  if (objectKey && supabaseClient) {
    try {
      const storage = supabaseClient.storage.from(UPLOADS_BUCKET);
      const { data, error } = await storage.download(objectKey);
      if (error || !data) {
        logger.warn('shopify-webhook paid_original_download_failed', {
          diagId,
          rid,
          orderId,
          bucket: UPLOADS_BUCKET,
          path: objectKey,
          status: error?.status || error?.statusCode || null,
          message: error?.message || null,
        });
      } else {
        const buffer = await dataToBuffer(data);
        if (buffer.length) {
          sourceInfo.type = 'supabase';
          sourceInfo.bucket = UPLOADS_BUCKET;
          sourceInfo.path = objectKey;
          return { buffer, sourceInfo };
        }
        logger.warn('shopify-webhook paid_original_empty', { diagId, rid, orderId, bucket: UPLOADS_BUCKET, path: objectKey });
      }
    } catch (err) {
      logger.error('shopify-webhook paid_original_download_exception', {
        diagId,
        rid,
        orderId,
        bucket: UPLOADS_BUCKET,
        path: objectKey,
        message: err?.message || err,
      });
    }
  }

  const parsedDataUrl = parseDataUrlBuffer(url);
  if (parsedDataUrl) {
    sourceInfo.type = 'data-url';
    sourceInfo.length = parsedDataUrl.length;
    return { buffer: parsedDataUrl, sourceInfo };
  }

  if (url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        logger.warn('shopify-webhook paid_original_fetch_failed', {
          diagId,
          rid,
          orderId,
          url,
          status: response.status,
          statusText: response.statusText,
        });
      } else {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length) {
          sourceInfo.type = 'url';
          sourceInfo.url = url;
          sourceInfo.status = response.status;
          return { buffer, sourceInfo };
        }
        logger.warn('shopify-webhook paid_original_fetch_empty', { diagId, rid, orderId, url });
      }
    } catch (err) {
      logger.error('shopify-webhook paid_original_fetch_exception', {
        diagId,
        rid,
        orderId,
        url,
        message: err?.message || err,
      });
    }
  }

  return { buffer: null, sourceInfo: null };
}

async function processOrderPaidLossless({
  supabaseClient,
  rid,
  orderId,
  diagId,
}) {
  const normalizedRid = safeTrim(rid);
  if (!supabaseClient || !normalizedRid) {
    logger.warn('shopify-webhook paid_lossless_skipped', { diagId, rid: normalizedRid || null, orderId });
    return;
  }

  logger.info('shopify-webhook paid_lossless_start', { diagId, rid: normalizedRid, orderId });

  const { data: publishRef, error: publishError } = await supabaseClient
    .from('publish_refs')
    .select('rid,product_id,original_object_key,original_url')
    .eq('rid', normalizedRid)
    .maybeSingle();

  if (publishError) {
    logger.error('shopify-webhook paid_publish_ref_error', {
      diagId,
      rid: normalizedRid,
      orderId,
      message: publishError?.message || publishError,
      code: publishError?.code || null,
    });
    return;
  }

  if (!publishRef) {
    logger.warn('shopify-webhook paid_publish_ref_missing', { diagId, rid: normalizedRid, orderId });
    return;
  }

  const jobSelect = await supabaseClient
    .from('jobs')
    .select('id,job_id,status,design_name,material,w_cm,h_cm,bleed_mm,bg,pdf_url,file_original_url,dpi')
    .eq('job_id', normalizedRid)
    .maybeSingle();

  if (jobSelect.error) {
    logger.error('shopify-webhook paid_job_lookup_error', {
      diagId,
      rid: normalizedRid,
      orderId,
      message: jobSelect.error?.message || jobSelect.error,
      code: jobSelect.error?.code || null,
    });
  }

  const job = jobSelect.data || null;

  const publishObjectKey = resolveUploadsObjectKey(publishRef.original_object_key)
    || resolveUploadsObjectKey(publishRef.original_url);
  const jobObjectKey = resolveUploadsObjectKey(job?.file_original_url);

  const objectKey = publishObjectKey || jobObjectKey || null;
  const urlCandidates = [publishRef.original_url, job?.file_original_url].map((candidate) => safeTrim(candidate));
  const fallbackUrl = urlCandidates.find((candidate) => candidate) || '';

  if (!objectKey && !fallbackUrl) {
    logger.warn('shopify-webhook paid_original_missing', {
      diagId,
      rid: normalizedRid,
      orderId,
    });
    return;
  }

  const { buffer: originalBuffer, sourceInfo } = await fetchOriginalBuffer({
    supabaseClient,
    objectKey,
    url: fallbackUrl,
    diagId,
    rid: normalizedRid,
    orderId,
  });

  if (!originalBuffer || !originalBuffer.length) {
    logger.warn('shopify-webhook paid_original_unavailable', {
      diagId,
      rid: normalizedRid,
      orderId,
      objectKey: objectKey || null,
      url: fallbackUrl || null,
    });
    return;
  }

  const header = originalBuffer.subarray(0, 4).toString('utf8');
  const isPdf = header.startsWith('%PDF');

  let pdfBuffer = originalBuffer;
  let pdfInfo = null;

  if (!isPdf) {
    const widthCm = toNumber(job?.w_cm);
    const heightCm = toNumber(job?.h_cm);
    const bleedValue = Number(job?.bleed_mm);
    const bleedCm = Number.isFinite(bleedValue) ? bleedValue / 10 : undefined;
    const dpiValue = Number(job?.dpi);
    const density = Number.isFinite(dpiValue) && dpiValue > 0 ? dpiValue : undefined;
    const backgroundCandidate = safeTrim(job?.bg);
    const background = backgroundCandidate || undefined;

    try {
      const pdfResult = await imageBufferToPdf({
        buffer: originalBuffer,
        widthCm: widthCm || undefined,
        heightCm: heightCm || undefined,
        bleedCm,
        density,
        background,
      });
      pdfBuffer = pdfResult?.pdfBuffer || null;
      pdfInfo = {
        density: pdfResult?.density ?? null,
        widthPx: pdfResult?.widthPx ?? null,
        heightPx: pdfResult?.heightPx ?? null,
        widthCm: pdfResult?.widthCm ?? null,
        heightCm: pdfResult?.heightCm ?? null,
        widthCmPrint: pdfResult?.widthCmPrint ?? null,
        heightCmPrint: pdfResult?.heightCmPrint ?? null,
      };
    } catch (err) {
      logger.error('shopify-webhook paid_pdf_generation_failed', {
        diagId,
        rid: normalizedRid,
        orderId,
        message: err?.message || err,
      });
      return;
    }
  }

  if (!pdfBuffer || !pdfBuffer.length) {
    logger.error('shopify-webhook paid_pdf_buffer_empty', { diagId, rid: normalizedRid, orderId });
    return;
  }

  const slug = safeTrim(job?.design_name) || publishRef.product_id || normalizedRid;
  const storageDetails = buildPrintStorageDetails({
    slug,
    widthCm: job?.w_cm,
    heightCm: job?.h_cm,
    material: job?.material,
    jobId: job?.job_id ?? normalizedRid,
    jobKey: job?.job_id ?? normalizedRid,
    fallbackFilename: `${normalizedRid}.pdf`,
  });

  const storagePath = storageDetails.path;
  const storage = supabaseClient.storage.from(OUTPUT_BUCKET);
  const metadata = buildUploadMetadata({
    rid: normalizedRid,
    orderId: orderId || null,
    jobId: job?.job_id ?? normalizedRid,
    jobInternalId: job?.id ?? null,
    productId: publishRef.product_id ?? null,
    material: job?.material ?? null,
    widthCm: job?.w_cm ?? null,
    heightCm: job?.h_cm ?? null,
  });

  const { error: uploadError } = await storage.upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
    cacheControl: PUBLIC_YEAR_CACHE_CONTROL,
    metadata,
  });

  if (uploadError) {
    logger.error('shopify-webhook paid_pdf_upload_failed', {
      diagId,
      rid: normalizedRid,
      orderId,
      path: storagePath,
      status: uploadError?.status || uploadError?.statusCode || null,
      message: uploadError?.message || uploadError,
    });
    return;
  }

  const { data: publicData } = storage.getPublicUrl(storagePath);
  const pdfPublicUrl = publicData?.publicUrl || null;

  if (job?.id) {
    const updates = { status: LOSSLESS_JOB_STATUS };
    if (pdfPublicUrl) updates.pdf_url = pdfPublicUrl;

    const { error: updateError } = await supabaseClient
      .from('jobs')
      .update(updates)
      .eq('id', job.id);

    if (updateError) {
      logger.error('shopify-webhook paid_job_update_failed', {
        diagId,
        rid: normalizedRid,
        orderId,
        jobId: job.id,
        message: updateError?.message || updateError,
        code: updateError?.code || null,
      });
    } else {
      logger.info('shopify-webhook paid_job_updated', {
        diagId,
        rid: normalizedRid,
        orderId,
        jobId: job.id,
        status: LOSSLESS_JOB_STATUS,
      });
    }

    const eventDetail = {
      rid: normalizedRid,
      order_id: orderId || null,
      pdf_path: storagePath,
      pdf_url: pdfPublicUrl,
      pdf_size_bytes: pdfBuffer.length,
      original_source: sourceInfo || null,
      ...(pdfInfo ? { pdf_info: pdfInfo } : {}),
    };

    const { error: eventError } = await supabaseClient.from('job_events').insert({
      job_id: job.id,
      event: LOSSLESS_JOB_EVENT,
      detail: eventDetail,
    });

    if (eventError) {
      logger.warn('shopify-webhook paid_job_event_failed', {
        diagId,
        rid: normalizedRid,
        orderId,
        jobId: job.id,
        message: eventError?.message || eventError,
        code: eventError?.code || null,
      });
    }
  } else {
    logger.warn('shopify-webhook paid_job_missing', { diagId, rid: normalizedRid, orderId });
  }

  logger.info('shopify-webhook paid_lossless_done', {
    diagId,
    rid: normalizedRid,
    orderId,
    path: storagePath,
  });
}

export default async function shopifyWebhook(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, diag_id: diagId, error: 'missing_webhook_secret' });
  }

  let rawBody;
  try {
    rawBody = await readRequestBody(req, { limit: 512 * 1024 });
  } catch (err) {
    if (err?.code === 'payload_too_large') {
      logger.error('shopify-webhook payload_too_large', { diagId });
    } else {
      logger.error('shopify-webhook read_error', { diagId, err });
    }
    res.status(200).json({ ok: true });
    return;
  }

  const signatureHeader = getHeaderValue(req, HMAC_HEADER);
  const provided = signatureHeader ? String(signatureHeader) : '';
  if (!provided) {
    logger.error('shopify-webhook missing_signature', { diagId });
    res.status(401).end();
    return;
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  if (!safeCompare(digest, provided)) {
    logger.error('shopify-webhook invalid_signature', { diagId });
    res.status(401).end();
    return;
  }

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    logger.error('shopify-webhook json_error', { diagId, err: err?.message || err });
    res.status(200).json({ ok: true });
    return;
  }

  const topic = getHeaderValue(req, 'x-shopify-topic') || null;
  const normalizedTopic = String(topic || '').toLowerCase();
  const orderId = payload?.id;
  const orderIdString = orderId == null ? null : String(orderId);
  const rid = extractRid(payload);
  const designSlug = extractDesignSlug(payload);
  const productHandle = extractProductHandle(payload);

  logger.info('shopify-webhook received', {
    diagId,
    topic,
    orderId: orderIdString,
    ridFound: Boolean(rid),
  });

  if (!ALLOWED_TOPICS.has(normalizedTopic)) {
    res.status(200).json({ ok: true });
    return;
  }

  const shopDomain = getHeaderValue(req, 'x-shopify-shop-domain') || null;

  if (!orderIdString) {
    logger.warn('shopify-webhook missing_order_id', { diagId, topic });
    res.status(200).json({ ok: true });
    return;
  }
  const amount = toNumber(payload?.total_price);
  const currency = toTrimmedString(payload?.currency);
  const lineItemsCount = Array.isArray(payload?.line_items) ? payload.line_items.length : 0;
  const details = {
    topic,
    line_items_count: lineItemsCount,
    email: toTrimmedString(payload?.email),
    financial_status: toTrimmedString(payload?.financial_status),
  };

  let supabaseClient;

  try {
    supabaseClient = getSupabaseAdmin();
    const client = supabaseClient;
    const { data: existing, error: selectError } = await client
      .from('events')
      .select('id')
      .eq('event_name', 'purchase_completed')
      .eq('order_id', orderIdString)
      .limit(1);

    if (selectError) {
      throw selectError;
    }

    if (!Array.isArray(existing) || existing.length === 0) {
      const userAgentHeader = getHeaderValue(req, 'user-agent');
      const userAgent = userAgentHeader ? String(userAgentHeader) : 'shopify-webhook';
      const insertPayload = {
        event_name: 'purchase_completed',
        rid,
        design_slug: designSlug,
        order_id: orderIdString,
        amount,
        currency,
        origin: shopDomain ? String(shopDomain) : null,
        user_agent: userAgent,
        referer: '',
        details,
      };

      const { error: insertError } = await client.from('events').insert(insertPayload);
      if (insertError) {
        throw insertError;
      }

      try {
        const trackInsert = {
          event_name: 'purchase_completed',
          rid,
          design_slug: designSlug,
          product_handle: productHandle,
          origin: shopDomain ? String(shopDomain) : null,
          user_agent: userAgent,
          referer: '',
          ip:
            typeof req.headers['x-forwarded-for'] === 'string'
              ? req.headers['x-forwarded-for'].split(',')[0].trim()
              : null,
          diag_id: diagId,
          created_at: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
          extra: {
            order_id: orderIdString,
            topic,
            amount,
            currency,
            line_items_count: lineItemsCount,
            product_handle: productHandle,
          },
        };
        const { error: trackError } = await client.from('track_events').insert(trackInsert);
        if (trackError && trackError.code !== '23505') {
          throw trackError;
        }
      } catch (trackErr) {
        logger.warn('shopify-webhook track_events_insert_failed', {
          diagId,
          topic,
          orderId: orderIdString,
          ridFound: Boolean(rid),
          err: trackErr,
        });
      }
    }
  } catch (err) {
    logger.error('shopify-webhook supabase_error', {
      diagId,
      topic,
      orderId: orderIdString,
      ridFound: Boolean(rid),
      err,
    });
    res.status(200).json({ ok: true });
    return;
  }

  if (normalizedTopic === 'orders/paid' && supabaseClient) {
    try {
      await processOrderPaidLossless({
        supabaseClient,
        rid,
        orderId: orderIdString,
        diagId,
      });
    } catch (err) {
      logger.error('shopify-webhook paid_lossless_unhandled', {
        diagId,
        rid: rid || null,
        orderId: orderIdString,
        message: err?.message || err,
      });
    }
  }

  logger.info('shopify-webhook processed', {
    diagId,
    topic,
    orderId: orderIdString,
    ridFound: Boolean(rid),
  });

  try {
    console.log('[webhook]', { diagId, rid: rid || null });
  } catch {}

  res.status(200).json({ ok: true });
}

