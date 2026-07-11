import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import logger from '../_lib/logger.js';
import { verifyAnalyticsAccess } from '../_lib/analyticsAuth.js';

const VISIT_EVENTS = new Set(['page_view', 'site_visit']);
const HOME_UPLOAD = 'home_image_uploaded';
const HOME_EDIT = 'home_step_edit';
const HOME_CONTINUE = 'continue_design';
const HOME_REVIEW = 'home_step_review';
const HOME_CART_EVENTS = new Set(['home_add_to_cart', 'home_add_private_cart', 'cta_click_cart']);
const PURCHASE = 'purchase_completed';

const MOCKUP_EVENTS = {
  view: 'mockup_view',
  options: 'view_purchase_options',
  public: 'cta_click_public',
  private: 'cta_click_private',
  cart: 'cta_click_cart',
  purchase: 'purchase_completed',
};

function parseDateParam(raw) {
  if (Array.isArray(raw)) return parseDateParam(raw[0]);
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function normalizeRid(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function intersectCount(a, b) {
  if (!a.size || !b.size) return 0;
  let total = 0;
  for (const value of a) {
    if (b.has(value)) total += 1;
  }
  return total;
}

function formatRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function readExtraString(extra, key) {
  if (!extra || typeof extra !== 'object') return null;
  const value = extra[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function toDateKey(iso) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString().slice(0, 10);
}

function classifyDevice(extra, userAgent) {
  const fromExtra = readExtraString(extra, 'device_type');
  if (fromExtra === 'mobile' || fromExtra === 'desktop') return fromExtra;

  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (!ua) return 'desktop';
  if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|iPad|Tablet|PlayBook|Silk/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

function buildDeviceBreakdown(deviceByRid) {
  let mobile = 0;
  let desktop = 0;
  for (const device of deviceByRid.values()) {
    if (device === 'mobile') mobile += 1;
    else desktop += 1;
  }
  const total = mobile + desktop;
  return {
    total,
    mobile: { visitors: mobile, percent: formatRate(mobile, total) },
    desktop: { visitors: desktop, percent: formatRate(desktop, total) },
  };
}

function emptyDashboard(fromIso, toIso, diagId, warning) {
  return {
    ok: true,
    diagId,
    from: fromIso,
    to: toIso,
    warning: warning || null,
    summary: {
      unique_visitors: 0,
      uploads: 0,
      reached_review: 0,
      added_to_cart: 0,
      purchases: 0,
      completion_rate: 0,
      upload_rate: 0,
      cart_rate: 0,
    },
    daily_visits: [],
    home_funnel: {},
    mockup_funnel: { view: 0, options: 0, clicks: 0, purchase: 0 },
    event_breakdown: [],
    top_materials: [],
    top_paths: [],
    devices: {
      total: 0,
      mobile: { visitors: 0, percent: 0 },
      desktop: { visitors: 0, percent: 0 },
    },
    last_events: [],
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export async function analyticsDashboard(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);

  const auth = verifyAnalyticsAccess(req);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, error: auth.error || 'unauthorized', diagId });
    return;
  }

  const now = new Date();
  const toParam = parseDateParam(req.query?.to);
  const toDate = toParam && !Number.isNaN(toParam.valueOf()) ? toParam : now;
  const fromParam = parseDateParam(req.query?.from);
  const defaultFrom = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  let fromDate = fromParam && !Number.isNaN(fromParam.valueOf()) ? fromParam : defaultFrom;
  if (fromDate > toDate) fromDate = defaultFrom;

  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    logger.error?.('analytics_dashboard_init_supabase_failed', { diagId, error: error?.message || error });
    sendJson(res, 200, emptyDashboard(fromIso, toIso, diagId, 'missing_env'));
    return;
  }

  const { data, error } = await supabase
    .from('track_events')
    .select('rid, event_name, cta_type, design_slug, extra, user_agent, created_at')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: false })
    .limit(10000);

  if (error) {
    logger.error?.('analytics_dashboard_query_failed', { diagId, error: error?.message || error });
    sendJson(res, 200, emptyDashboard(fromIso, toIso, diagId, 'track_events_unavailable'));
    return;
  }

  const rows = Array.isArray(data) ? data : [];

  const visitSet = new Set();
  const uploadSet = new Set();
  const editSet = new Set();
  const continueSet = new Set();
  const reviewSet = new Set();
  const cartSet = new Set();
  const purchaseSet = new Set();
  const mockupViewSet = new Set();
  const mockupOptionsSet = new Set();
  const mockupClickSet = new Set();
  const eventCounts = new Map();
  const dailyMap = new Map();
  const materialCounts = new Map();
  const pathCounts = new Map();
  const deviceByRid = new Map();

  for (const row of rows) {
    const rid = normalizeRid(row?.rid);
    const eventName = row?.event_name ?? '';
    if (!eventName) continue;

    if (!eventCounts.has(eventName)) {
      eventCounts.set(eventName, { total: 0, rids: new Set() });
    }
    const counter = eventCounts.get(eventName);
    counter.total += 1;
    if (rid) counter.rids.add(rid);

    if (VISIT_EVENTS.has(eventName) && rid) {
      visitSet.add(rid);
      if (!deviceByRid.has(rid)) {
        deviceByRid.set(rid, classifyDevice(row.extra, row.user_agent));
      }
      const dateKey = toDateKey(row.created_at);
      if (dateKey) {
        if (!dailyMap.has(dateKey)) {
          dailyMap.set(dateKey, { visitors: new Set(), pageViews: 0 });
        }
        const day = dailyMap.get(dateKey);
        day.visitors.add(rid);
        day.pageViews += 1;
      }
      const path = readExtraString(row.extra, 'path');
      if (path) pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    }

    if (eventName === HOME_UPLOAD && rid) uploadSet.add(rid);
    if (eventName === HOME_EDIT && rid) editSet.add(rid);
    if (eventName === HOME_CONTINUE && rid) continueSet.add(rid);
    if (eventName === HOME_REVIEW && rid) reviewSet.add(rid);
    if (HOME_CART_EVENTS.has(eventName) && rid) cartSet.add(rid);
    if (eventName === PURCHASE && rid) purchaseSet.add(rid);
    if (eventName === MOCKUP_EVENTS.view && rid) mockupViewSet.add(rid);
    if (eventName === MOCKUP_EVENTS.options && rid) mockupOptionsSet.add(rid);
    if (
      eventName === MOCKUP_EVENTS.public
      || eventName === MOCKUP_EVENTS.private
      || eventName === MOCKUP_EVENTS.cart
    ) {
      if (rid) mockupClickSet.add(rid);
    }

    const material = readExtraString(row.extra, 'material');
    if (material && (
      eventName === HOME_UPLOAD
      || eventName === HOME_CONTINUE
      || HOME_CART_EVENTS.has(eventName)
    )) {
      materialCounts.set(material, (materialCounts.get(material) ?? 0) + 1);
    }
  }

  const visitToUpload = intersectCount(visitSet, uploadSet);
  const uploadToEdit = intersectCount(uploadSet, editSet);
  const editToContinue = intersectCount(editSet, continueSet);
  const continueToReview = intersectCount(continueSet, reviewSet);
  const reviewToCart = intersectCount(reviewSet, cartSet);
  const cartToPurchase = intersectCount(cartSet, purchaseSet);
  const visitToPurchase = intersectCount(visitSet, purchaseSet);

  const homeFunnel = {
    visit: { label: 'Visitas', rids: visitSet.size },
    upload: {
      label: 'Subieron imagen',
      rids: uploadSet.size,
      rate_from_visit: formatRate(visitToUpload, visitSet.size),
      drop_off_from_visit: formatRate(visitSet.size - visitToUpload, visitSet.size),
    },
    edit: {
      label: 'Paso edición',
      rids: editSet.size,
      rate_from_upload: formatRate(uploadToEdit, uploadSet.size),
      drop_off_from_upload: formatRate(uploadSet.size - uploadToEdit, uploadSet.size),
    },
    continue: {
      label: 'Confirmaron diseño',
      rids: continueSet.size,
      rate_from_edit: formatRate(editToContinue, editSet.size),
      drop_off_from_edit: formatRate(editSet.size - editToContinue, editSet.size),
    },
    review: {
      label: 'Paso revisión',
      rids: reviewSet.size,
      rate_from_continue: formatRate(continueToReview, continueSet.size),
      drop_off_from_continue: formatRate(continueSet.size - continueToReview, continueSet.size),
    },
    cart: {
      label: 'Agregaron al carrito',
      rids: cartSet.size,
      rate_from_review: formatRate(reviewToCart, reviewSet.size),
      drop_off_from_review: formatRate(reviewSet.size - reviewToCart, reviewSet.size),
    },
    purchase: {
      label: 'Compra completada',
      rids: purchaseSet.size,
      rate_from_cart: formatRate(cartToPurchase, cartSet.size),
      rate_from_visit: formatRate(visitToPurchase, visitSet.size),
    },
  };

  const dailyVisits = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, stats]) => ({
      date,
      visitors: stats.visitors.size,
      page_views: stats.pageViews,
    }));

  const eventBreakdown = Array.from(eventCounts.entries())
    .map(([event_name, stats]) => ({
      event_name,
      count: stats.total,
      unique_rids: stats.rids.size,
    }))
    .sort((a, b) => b.count - a.count);

  const topMaterials = Array.from(materialCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([material, count]) => ({ material, count }));

  const topPaths = Array.from(pathCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, views]) => ({ path, views }));

  sendJson(res, 200, {
    ok: true,
    diagId,
    from: fromIso,
    to: toIso,
    summary: {
      unique_visitors: visitSet.size,
      uploads: uploadSet.size,
      reached_review: reviewSet.size,
      added_to_cart: cartSet.size,
      purchases: purchaseSet.size,
      completion_rate: formatRate(visitToPurchase, visitSet.size),
      upload_rate: formatRate(visitToUpload, visitSet.size),
      cart_rate: formatRate(reviewToCart, reviewSet.size),
    },
    daily_visits: dailyVisits,
    home_funnel: homeFunnel,
    mockup_funnel: {
      view: mockupViewSet.size,
      options: mockupOptionsSet.size,
      clicks: mockupClickSet.size,
      purchase: purchaseSet.size,
    },
    event_breakdown: eventBreakdown,
    top_materials: topMaterials,
    top_paths: topPaths,
    devices: buildDeviceBreakdown(deviceByRid),
    last_events: rows.slice(0, 50).map((row) => ({
      rid: row.rid,
      event_name: row.event_name,
      created_at: row.created_at,
      design_slug: row.design_slug,
    })),
  });
}

export default analyticsDashboard;
