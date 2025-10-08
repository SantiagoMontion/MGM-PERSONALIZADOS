import crypto from 'node:crypto';
import sharp from 'sharp';
import { readRequestBody } from '../_lib/http.js';
import logger from '../_lib/logger.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import imageBufferToPdf from '../_lib/imageToPdf.js';
import savePrintPdfToSupabase, { savePrintPreviewToSupabase } from '../_lib/savePrintPdfToSupabase.js';
import { slugifyName } from '../_lib/slug.js';

const ALLOWED_TOPICS = new Set(['orders/create', 'orders/paid']);
const HMAC_HEADER = 'x-shopify-hmac-sha256';
const PDF_ON_PURCHASE_ONLY = process.env.PDF_ON_PURCHASE_ONLY === '1';
const OUTPUT_BUCKET = 'outputs';
const DEFAULT_UPLOADS_BUCKET = process.env.SUPABASE_UPLOADS_BUCKET || 'uploads';

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

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatNumberForKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/0$/, '');
}

function sanitizeMaterialForKey(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'material';
  const slug = slugifyName(raw);
  if (slug) return slug;
  return raw
    .normalize('NFD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
    || 'material';
}

function buildPrintsJobKey({ slug, widthCm, heightCm, material, backgroundColor, imageHash }) {
  const widthSegment = formatNumberForKey(widthCm);
  const heightSegment = formatNumberForKey(heightCm);
  return [
    slug || 'diseno',
    widthSegment,
    heightSegment,
    sanitizeMaterialForKey(material),
    (backgroundColor || '#ffffff').toLowerCase(),
    imageHash || 'hash',
  ].join('|');
}

function computeImageHash(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
  if (buffer instanceof Uint8Array && buffer.length) {
    return crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  }
  return crypto.createHash('sha256').update('empty').digest('hex');
}

function normalizeBackgroundHex(input) {
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!raw) return '#ffffff';
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match) return '#ffffff';
  const hex = match[1];
  if (hex.length === 3) {
    return `#${hex.split('').map((c) => c + c).join('')}`;
  }
  return `#${hex}`;
}

function extractSupabaseObjectParts(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    const match = /\/storage\/v1\/object\/(?:sign|signed|download|upload\/sign)?\/?(?:public\/)?([^/]+)\/(.+)/i.exec(
      parsed.pathname,
    );
    if (!match) return null;
    return {
      bucket: decodeURIComponent(match[1]),
      path: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
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

async function generateDeferredPdf({ rid, diagId }) {
  if (!rid) return;
  try {
    const client = getSupabaseAdmin();
    const { data, error } = await client
      .from('events')
      .select('id, job_id, details, created_at')
      .eq('event_name', 'publish_product')
      .eq('rid', rid)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      throw error;
    }
    if (!Array.isArray(data) || data.length === 0) {
      logger.warn('shopify-webhook publish_event_not_found', { rid, diagId });
      return;
    }
    const publishEvent = data[0];
    const details = publishEvent.details && typeof publishEvent.details === 'object' ? publishEvent.details : {};
    const originalDetails = details.original && typeof details.original === 'object' ? details.original : {};
    const mockupDetails = details.mockup && typeof details.mockup === 'object' ? details.mockup : {};
    const printDetails = details.print && typeof details.print === 'object' ? details.print : {};
    const designName =
      typeof details.designName === 'string'
        ? details.designName
        : typeof details.design_name === 'string'
          ? details.design_name
          : 'diseno';

    let bucket = originalDetails.bucket || DEFAULT_UPLOADS_BUCKET;
    let objectKey = originalDetails.objectKey || null;
    let originalUrl = originalDetails.url || null;

    if ((!objectKey || !bucket) && originalUrl) {
      const parts = extractSupabaseObjectParts(originalUrl);
      if (parts) {
        bucket = parts.bucket || bucket;
        objectKey = parts.path || objectKey;
      }
    }

    let imageBuffer = null;

    if (objectKey) {
      try {
        const { data: fileData, error: fileError } = await client.storage.from(bucket).download(objectKey);
        if (!fileError && fileData) {
          const arrayBuffer = await fileData.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuffer);
        }
      } catch (storageErr) {
        logger.warn('shopify-webhook original_download_failed', {
          rid,
          diagId,
          message: storageErr?.message || storageErr,
        });
      }
    }

    if ((!imageBuffer || !imageBuffer.length) && originalUrl) {
      try {
        const response = await fetch(originalUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuffer);
        } else {
          logger.warn('shopify-webhook original_fetch_failed', {
            rid,
            diagId,
            status: response.status,
          });
        }
      } catch (fetchErr) {
        logger.warn('shopify-webhook original_fetch_exception', {
          rid,
          diagId,
          message: fetchErr?.message || fetchErr,
        });
      }
    }

    if (!imageBuffer || !imageBuffer.length) {
      logger.warn('shopify-webhook original_buffer_missing', { rid, diagId });
      return;
    }

    const widthValue = isFiniteNumber(printDetails.widthCm) ? Number(printDetails.widthCm) : null;
    const heightValue = isFiniteNumber(printDetails.heightCm) ? Number(printDetails.heightCm) : null;
    const approxDensity = isFiniteNumber(printDetails.approxDpi) ? Number(printDetails.approxDpi) : null;
    const requestedDensity = isFiniteNumber(printDetails.requestedDpi) ? Number(printDetails.requestedDpi) : null;
    const density = requestedDensity || (approxDensity && approxDensity > 0 ? approxDensity : 300);
    const background = typeof printDetails.backgroundColor === 'string' && printDetails.backgroundColor
      ? printDetails.backgroundColor
      : '#ffffff';

    const EXTRA_MARGIN_TOTAL_CM = 2;
    const marginPerSideCm = EXTRA_MARGIN_TOTAL_CM / 2;
    const finalWidthCm = widthValue != null ? widthValue + EXTRA_MARGIN_TOTAL_CM : null;
    const finalHeightCm = heightValue != null ? heightValue + EXTRA_MARGIN_TOTAL_CM : null;

    const pdfResult = await imageBufferToPdf({
      buffer: imageBuffer,
      density,
      background,
      widthCm: widthValue || undefined,
      heightCm: heightValue || undefined,
      bleedCm: marginPerSideCm,
    });

    const normalizedBg = normalizeBackgroundHex(background);
    const imageHash = computeImageHash(imageBuffer);
    const jobKey = buildPrintsJobKey({
      slug: pdfSlug,
      widthCm: finalWidthCm ?? widthValue,
      heightCm: finalHeightCm ?? heightValue,
      material: details.material || null,
      backgroundColor: normalizedBg,
      imageHash,
    });

    const previewBuffer = await sharp(imageBuffer)
      .resize({ width: 600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70, chromaSubsampling: '4:2:0' })
      .toBuffer();

    const pdfSlug = slugifyName(designName) || 'diseno';

    const pdfMetadata = {
      slug: pdfSlug,
      designName,
      widthCm: widthValue ?? undefined,
      heightCm: heightValue ?? undefined,
      widthCmPrint: finalWidthCm ?? undefined,
      heightCmPrint: finalHeightCm ?? undefined,
      material: details.material || null,
      createdBy: 'shopify-webhook',
      backgroundColor: background,
      ...(publishEvent.job_id ? { jobId: publishEvent.job_id } : {}),
    };

    const pdfUpload = await savePrintPdfToSupabase(pdfResult.pdfBuffer, `${pdfSlug}.pdf`, pdfMetadata);

    let previewUpload = null;
    try {
      previewUpload = await savePrintPreviewToSupabase(previewBuffer, `${pdfSlug}.jpg`, {
        jobId: publishEvent.job_id || null,
        jobKey,
        slug: pdfSlug,
        widthCm: widthValue ?? undefined,
        heightCm: heightValue ?? undefined,
        material: details.material || null,
        createdBy: 'shopify-webhook',
      });
    } catch (previewErr) {
      logger.warn('shopify-webhook preview_store_warning', {
        rid,
        diagId,
        message: previewErr?.message || previewErr,
      });
    }

    const previewPath = previewUpload?.path
      ? (previewUpload.path.startsWith('outputs/') ? previewUpload.path : `outputs/${previewUpload.path}`)
      : (pdfUpload.path.startsWith('outputs/') ? pdfUpload.path : `outputs/${pdfUpload.path}`);
    const previewUrl = `/api/prints/preview?path=${encodeURIComponent(previewPath)}`;

    try {
      const { error: printsErr } = await client.from('prints').upsert({
        job_key: jobKey,
        bucket: OUTPUT_BUCKET,
        file_path: pdfUpload.path,
        file_name: pdfUpload.fileName || pdfUpload.path.split('/').pop(),
        slug: pdfSlug,
        width_cm: finalWidthCm ?? widthValue ?? null,
        height_cm: finalHeightCm ?? heightValue ?? null,
        material: details.material || null,
        bg_color: normalizedBg,
        job_id: publishEvent.job_id || null,
        file_size_bytes: pdfResult.pdfBuffer.length,
        image_hash: imageHash,
      }, { onConflict: 'job_key', ignoreDuplicates: false });
      if (printsErr) {
        logger.error('shopify-webhook prints_upsert_failed', {
          rid,
          diagId,
          message: printsErr.message,
        });
      }
    } catch (printsErr) {
      logger.error('shopify-webhook prints_upsert_exception', {
        rid,
        diagId,
        message: printsErr?.message || printsErr,
      });
    }

    const finalPdfUrl = pdfUpload.publicUrl || pdfUpload.signedUrl || null;
    if (publishEvent.job_id || details.jobId) {
      try {
        const { error: jobError } = await client
          .from('jobs')
          .update({
            status: 'ASSETS_READY',
            pdf_url: finalPdfUrl,
            preview_url: mockupDetails.url || previewUrl,
          })
          .eq('job_id', publishEvent.job_id || details.jobId);
        if (jobError) {
          logger.warn('shopify-webhook job_update_failed', {
            rid,
            diagId,
            jobId: publishEvent.job_id || details.jobId,
            message: jobError.message,
          });
        }
      } catch (jobErr) {
        logger.warn('shopify-webhook job_update_exception', {
          rid,
          diagId,
          jobId: publishEvent.job_id || details.jobId,
          message: jobErr?.message || jobErr,
        });
      }
    }

    try {
      const updatedDetails = {
        ...details,
        pdfGeneratedAt: new Date().toISOString(),
        pdfPath: pdfUpload.path,
      };
      await client.from('events').update({ details: updatedDetails }).eq('id', publishEvent.id);
    } catch (eventUpdateErr) {
      logger.warn('shopify-webhook publish_event_update_failed', {
        rid,
        diagId,
        message: eventUpdateErr?.message || eventUpdateErr,
      });
    }

    logger.info('shopify-webhook deferred_pdf_generated', {
      rid,
      diagId,
      jobId: publishEvent.job_id || details.jobId || null,
    });
  } catch (err) {
    logger.error('shopify-webhook deferred_pdf_error', {
      rid,
      diagId,
      message: err?.message || err,
    });
  }
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

  try {
    const client = getSupabaseAdmin();
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

  logger.info('shopify-webhook processed', {
    diagId,
    topic,
    orderId: orderIdString,
    ridFound: Boolean(rid),
  });

  try {
    console.log('[webhook]', { diagId, rid: rid || null });
  } catch {}

  if (PDF_ON_PURCHASE_ONLY && rid) {
    await generateDeferredPdf({ rid, diagId });
  }

  res.status(200).json({ ok: true });
}

