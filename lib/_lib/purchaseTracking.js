import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from './supabaseAdmin.js';
import logger from './logger.js';

const PURCHASE_EVENT = 'purchase_completed';
const CART_EVENTS = ['home_add_to_cart', 'home_add_private_cart', 'cta_click_cart'];
const PAID_TOPICS = new Set(['orders/paid', 'orders/updated', 'orders/create']);

function normalizeString(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readAttributeValue(entries, keys) {
  if (!Array.isArray(entries)) return null;
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const name = normalizeString(entry.name) || normalizeString(entry.key);
    if (!name || !wanted.has(name.toLowerCase())) continue;
    const value = normalizeString(entry.value);
    if (value) return value;
  }
  return null;
}

function collectLineProperties(lineItems) {
  const merged = {};
  if (!Array.isArray(lineItems)) return merged;
  for (const line of lineItems) {
    const props = Array.isArray(line?.properties) ? line.properties : [];
    for (const prop of props) {
      if (!prop || typeof prop !== 'object') continue;
      const name = normalizeString(prop.name);
      const value = normalizeString(prop.value);
      if (!name || !value) continue;
      const lowered = name.toLowerCase();
      if (!merged[lowered]) merged[lowered] = value;
    }
  }
  return merged;
}

function parseDimensionsFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return { width: null, height: null };
  const match = text.match(/(\d{2,3})\s*[x×]\s*(\d{2,3})/i);
  if (!match) return { width: null, height: null };
  return {
    width: normalizeString(match[1]),
    height: normalizeString(match[2]),
  };
}

export function extractOrderTrackingFields(order) {
  if (!order || typeof order !== 'object') {
    return {
      rid: null,
      jobId: null,
      material: null,
      widthCm: null,
      heightCm: null,
      designSlug: null,
      productHandle: null,
      orderId: null,
      orderName: null,
      totalPrice: null,
      currency: null,
      quantity: null,
      financialStatus: null,
      customerEmail: null,
      createdAt: null,
    };
  }

  const noteAttributes = order.note_attributes;
  const lineProps = collectLineProperties(order.line_items);
  const firstLine = Array.isArray(order.line_items) ? order.line_items[0] : null;
  const titleText = [
    firstLine?.title,
    firstLine?.name,
    firstLine?.variant_title,
  ].filter(Boolean).join(' ');
  const parsedDims = parseDimensionsFromText(titleText);

  const rid = readAttributeValue(noteAttributes, ['rid', '_rid', 'analytics_rid'])
    || lineProps.rid
    || lineProps._rid
    || lineProps.analytics_rid
    || null;

  const jobId = readAttributeValue(noteAttributes, ['job_id', 'jobid'])
    || lineProps.job_id
    || lineProps.jobid
    || null;

  const material = readAttributeValue(noteAttributes, ['material'])
    || lineProps.material
    || null;

  const measurementRaw = readAttributeValue(noteAttributes, ['measurement_cm', 'measurement'])
    || lineProps.measurement_cm
    || lineProps.measurement
    || null;
  let widthCm = parsedDims.width;
  let heightCm = parsedDims.height;
  if (measurementRaw) {
    const measurementDims = parseDimensionsFromText(measurementRaw);
    widthCm = measurementDims.width || widthCm;
    heightCm = measurementDims.height || heightCm;
  }

  const designSlug = readAttributeValue(noteAttributes, ['design_slug', 'designslug'])
    || lineProps.design_slug
    || lineProps.designslug
    || null;

  const quantity = Array.isArray(order.line_items)
    ? order.line_items.reduce((sum, line) => {
      const qty = Number(line?.quantity);
      return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
    }, 0)
    : null;

  return {
    rid,
    jobId,
    material,
    widthCm,
    heightCm,
    designSlug,
    productHandle: normalizeString(firstLine?.product_id) || null,
    orderId: normalizeString(order.id),
    orderName: normalizeString(order.name) || normalizeString(order.order_number),
    totalPrice: normalizeString(order.total_price) || normalizeString(order.current_total_price),
    currency: normalizeString(order.currency) || normalizeString(order.presentment_currency),
    quantity: quantity || null,
    financialStatus: normalizeString(order.financial_status),
    customerEmail: normalizeString(order?.customer?.email) || normalizeString(order?.email),
    createdAt: normalizeString(order.created_at) || normalizeString(order.processed_at),
  };
}

function isPaidOrder(order, topic) {
  const status = normalizeString(order?.financial_status)?.toLowerCase();
  if (status !== 'paid' && status !== 'partially_paid') return false;
  if (topic === 'orders/paid') return true;
  if (topic === 'orders/create' || topic === 'orders/updated') return true;
  return false;
}

async function orderAlreadyTracked(supabase, orderId) {
  if (!orderId) return false;
  const { data, error } = await supabase
    .from('track_events')
    .select('id')
    .eq('event_name', PURCHASE_EVENT)
    .contains('extra', { shopify_order_id: orderId })
    .limit(1);
  if (error) {
    logger.warn?.('purchase_tracking_order_lookup_failed', { orderId, error: error.message });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function resolveRidFromJobId(supabase, jobId) {
  if (!jobId) return null;
  const { data, error } = await supabase
    .from('track_events')
    .select('rid, created_at')
    .in('event_name', CART_EVENTS)
    .contains('extra', { job_id: jobId })
    .not('rid', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data) || !data.length) return null;
  return normalizeString(data[0]?.rid);
}

async function resolveRidFromDimensions(supabase, fields) {
  const width = fields.widthCm;
  const height = fields.heightCm;
  if (!width || !height) return null;

  const createdAt = fields.createdAt ? new Date(fields.createdAt) : new Date();
  const windowStart = new Date(createdAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('track_events')
    .select('rid, extra, created_at')
    .in('event_name', CART_EVENTS)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .not('rid', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error || !Array.isArray(data)) return null;

  const widthCandidates = new Set([width, String(Number(width))]);
  const heightCandidates = new Set([height, String(Number(height))]);

  for (const row of data) {
    const extra = row?.extra && typeof row.extra === 'object' ? row.extra : {};
    const rowWidthRaw = extra.width_cm;
    const rowHeightRaw = extra.height_cm;
    const rowWidth = normalizeString(rowWidthRaw)
      || (Number.isFinite(Number(rowWidthRaw)) ? String(Math.round(Number(rowWidthRaw))) : null);
    const rowHeight = normalizeString(rowHeightRaw)
      || (Number.isFinite(Number(rowHeightRaw)) ? String(Math.round(Number(rowHeightRaw))) : null);
    if (!rowWidth || !rowHeight) continue;
    if (!widthCandidates.has(rowWidth) || !heightCandidates.has(rowHeight)) continue;
    const rid = normalizeString(row.rid);
    if (rid) return rid;
  }
  return null;
}

async function resolveDeviceTypeForRid(supabase, rid) {
  if (!rid) return null;
  const { data, error } = await supabase
    .from('track_events')
    .select('extra, user_agent, event_name, created_at')
    .eq('rid', rid)
    .neq('event_name', PURCHASE_EVENT)
    .order('created_at', { ascending: true })
    .limit(40);

  if (error || !Array.isArray(data)) return null;

  for (const row of data) {
    const extra = row?.extra && typeof row.extra === 'object' ? row.extra : {};
    const device = normalizeString(extra.device_type);
    if (device === 'mobile' || device === 'desktop') return device;
  }

  for (const row of data) {
    const ua = typeof row?.user_agent === 'string' ? row.user_agent : '';
    if (!ua) continue;
    if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|iPad|Tablet|PlayBook|Silk/i.test(ua)) {
      return 'mobile';
    }
    return 'desktop';
  }

  return null;
}

async function resolveRidFromNearestCart(supabase, fields) {
  const createdAt = fields.createdAt ? new Date(fields.createdAt) : new Date();
  const windowStart = new Date(createdAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('track_events')
    .select('rid, created_at')
    .in('event_name', CART_EVENTS)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .not('rid', 'is', null)
    .order('created_at', { ascending: false })
    .limit(80);

  if (error || !Array.isArray(data) || !data.length) return null;

  const orderMs = createdAt.getTime();
  let bestRid = null;
  let bestDelta = Infinity;

  for (const row of data) {
    const rid = normalizeString(row.rid);
    if (!rid) continue;
    const eventMs = new Date(row.created_at).getTime();
    if (!Number.isFinite(eventMs)) continue;
    const delta = Math.abs(orderMs - eventMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestRid = rid;
    }
  }

  return bestRid;
}

async function resolveRidForOrder(supabase, fields) {
  if (fields.rid) return fields.rid;

  const fromJob = await resolveRidFromJobId(supabase, fields.jobId);
  if (fromJob) return fromJob;

  const fromDims = await resolveRidFromDimensions(supabase, fields);
  if (fromDims) return fromDims;

  return resolveRidFromNearestCart(supabase, fields);
}

function buildPurchaseInsert(fields, rid, diagId, topic, deviceType = null) {
  const extra = {
    shopify_order_id: fields.orderId,
    shopify_order_name: fields.orderName,
    total_price: fields.totalPrice,
    currency: fields.currency,
    quantity: fields.quantity,
    financial_status: fields.financialStatus,
    customer_email: fields.customerEmail,
    job_id: fields.jobId,
    material: fields.material,
    width_cm: fields.widthCm,
    height_cm: fields.heightCm,
    webhook_topic: topic,
    source: 'shopify_webhook',
    ...(deviceType === 'mobile' || deviceType === 'desktop'
      ? { device_type: deviceType }
      : {}),
  };

  for (const key of Object.keys(extra)) {
    if (extra[key] == null || extra[key] === '') delete extra[key];
  }

  return {
    event_name: PURCHASE_EVENT,
    rid,
    design_slug: fields.designSlug,
    product_handle: fields.productHandle,
    extra,
    referer: 'shopify-webhook',
    origin: 'shopify',
    diag_id: diagId,
    created_at: fields.createdAt
      ? new Date(fields.createdAt).toISOString()
      : new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
  };
}

export async function processPaidShopifyOrder(order, { topic, diagId } = {}) {
  const normalizedTopic = normalizeString(topic) || 'orders/paid';
  if (!PAID_TOPICS.has(normalizedTopic)) {
    return { ok: true, skipped: true, reason: 'topic_ignored' };
  }
  if (!isPaidOrder(order, normalizedTopic)) {
    return { ok: true, skipped: true, reason: 'not_paid' };
  }

  const fields = extractOrderTrackingFields(order);
  if (!fields.orderId) {
    return { ok: true, skipped: true, reason: 'missing_order_id' };
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    logger.error?.('purchase_tracking_supabase_init_failed', {
      diagId,
      error: error?.message || error,
    });
    return { ok: false, reason: 'supabase_unavailable' };
  }

  if (await orderAlreadyTracked(supabase, fields.orderId)) {
    return { ok: true, skipped: true, reason: 'already_tracked', orderId: fields.orderId };
  }

  const rid = await resolveRidForOrder(supabase, fields);
  if (!rid) {
    logger.warn?.('purchase_tracking_missing_rid', {
      diagId,
      orderId: fields.orderId,
      orderName: fields.orderName,
      jobId: fields.jobId,
      widthCm: fields.widthCm,
      heightCm: fields.heightCm,
    });
    return { ok: true, skipped: true, reason: 'missing_rid', orderId: fields.orderId };
  }

  let deviceType = null;
  try {
    deviceType = await resolveDeviceTypeForRid(supabase, rid);
  } catch (deviceErr) {
    logger.warn?.('purchase_tracking_device_lookup_failed', {
      diagId,
      rid,
      error: deviceErr?.message || deviceErr,
    });
  }

  const insertPayload = buildPurchaseInsert(
    fields,
    rid,
    diagId || randomUUID(),
    normalizedTopic,
    deviceType,
  );

  try {
    const { error } = await supabase.from('track_events').insert(insertPayload);
    if (error) {
      if (error.code === '23505') {
        return { ok: true, skipped: true, reason: 'duplicate', rid, orderId: fields.orderId };
      }
      throw error;
    }
  } catch (error) {
    logger.error?.('purchase_tracking_insert_failed', {
      diagId,
      rid,
      orderId: fields.orderId,
      error: error?.message || error,
    });
    return { ok: false, reason: 'insert_failed', orderId: fields.orderId };
  }

  logger.info?.('purchase_tracking_recorded', {
    diagId,
    rid,
    orderId: fields.orderId,
    orderName: fields.orderName,
    topic: normalizedTopic,
  });

  return { ok: true, recorded: true, rid, orderId: fields.orderId };
}

export function parseShopifyOrderPayload(rawBody) {
  if (!rawBody || !rawBody.length) return null;
  try {
    const parsed = JSON.parse(rawBody.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeOrderName(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  return raw.replace(/^#+/, '').trim() || null;
}

export async function fetchShopifyPaidOrders({ sinceDays = 14, orderName } = {}) {
  const { shopifyAdmin } = await import('../shopify.js');
  const params = new URLSearchParams();
  params.set('status', 'any');
  params.set('financial_status', 'paid');
  params.set('limit', '50');

  const normalizedName = normalizeOrderName(orderName);
  if (normalizedName) {
    params.set('name', normalizedName);
  } else {
    const since = new Date(Date.now() - Math.max(1, sinceDays) * 24 * 60 * 60 * 1000);
    params.set('created_at_min', since.toISOString());
  }

  const resp = await shopifyAdmin(`orders.json?${params.toString()}`, { method: 'GET' });
  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    const detail = json?.errors || text?.slice(0, 300) || `http_${resp.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  return Array.isArray(json?.orders) ? json.orders : [];
}

export async function syncPaidOrdersFromShopify(options = {}) {
  const orders = await fetchShopifyPaidOrders(options);
  const results = [];

  for (const order of orders) {
    const result = await processPaidShopifyOrder(order, {
      topic: 'orders/paid',
      diagId: randomUUID(),
    });
    results.push({
      order_id: normalizeString(order?.id),
      order_name: normalizeString(order?.name) || normalizeString(order?.order_number),
      financial_status: normalizeString(order?.financial_status),
      ...result,
    });
  }

  const recorded = results.filter((row) => row.recorded).length;
  const skipped = results.filter((row) => row.skipped).length;
  const failed = results.filter((row) => row.ok === false).length;

  return {
    ok: true,
    scanned: orders.length,
    recorded,
    skipped,
    failed,
    results,
  };
}

const AUTO_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
let lastAutoSyncAt = 0;

export async function maybeAutoSyncPaidOrders({ sinceDays = 14, force = false } = {}) {
  const now = Date.now();
  if (!force && lastAutoSyncAt > 0 && now - lastAutoSyncAt < AUTO_SYNC_COOLDOWN_MS) {
    return {
      ok: true,
      skipped: true,
      reason: 'cooldown',
      cooldown_remaining_ms: AUTO_SYNC_COOLDOWN_MS - (now - lastAutoSyncAt),
    };
  }

  lastAutoSyncAt = now;
  try {
    const result = await syncPaidOrdersFromShopify({ sinceDays });
    return { ...result, auto: !force };
  } catch (error) {
    lastAutoSyncAt = 0;
    throw error;
  }
}
