import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../_lib/supabaseAdmin.js';
import { getEnv } from '../_lib/env.js';
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

function readExtraNumber(extra, key) {
  if (!extra || typeof extra !== 'object') return null;
  const value = extra[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatSizeLabel(width, height) {
  if (width == null || height == null) return null;
  const formatCm = (value) => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, '');
  };
  return `${formatCm(width)} × ${formatCm(height)} cm`;
}

function isPreferenceEvent(eventName) {
  return eventName === HOME_UPLOAD
    || eventName === HOME_CONTINUE
    || HOME_CART_EVENTS.has(eventName);
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

function countRidsByDevice(deviceByRid, ridSet, deviceType) {
  let count = 0;
  for (const rid of ridSet) {
    if (deviceByRid.get(rid) === deviceType) count += 1;
  }
  return count;
}

function buildDeviceProfile(deviceByRid, sets, deviceType) {
  const visitors = countRidsByDevice(deviceByRid, sets.visits, deviceType);
  const uploads = countRidsByDevice(deviceByRid, sets.uploads, deviceType);
  const reachedReview = countRidsByDevice(deviceByRid, sets.review, deviceType);
  const addedToCart = countRidsByDevice(deviceByRid, sets.cart, deviceType);
  const purchases = countRidsByDevice(deviceByRid, sets.purchases, deviceType);

  return {
    visitors,
    uploads,
    reached_review: reachedReview,
    added_to_cart: addedToCart,
    purchases,
    upload_rate: formatRate(uploads, visitors),
    cart_rate: formatRate(addedToCart, reachedReview),
    completion_rate: formatRate(purchases, visitors),
  };
}

function buildDeviceBreakdown(deviceByRid, sets) {
  const mobile = buildDeviceProfile(deviceByRid, sets, 'mobile');
  const desktop = buildDeviceProfile(deviceByRid, sets, 'desktop');
  const totalVisitors = mobile.visitors + desktop.visitors;
  const totalPurchases = mobile.purchases + desktop.purchases;

  mobile.visit_share = formatRate(mobile.visitors, totalVisitors);
  desktop.visit_share = formatRate(desktop.visitors, totalVisitors);
  mobile.purchase_share = formatRate(mobile.purchases, totalPurchases);
  desktop.purchase_share = formatRate(desktop.purchases, totalPurchases);

  // Compatibilidad con UI anterior
  mobile.percent = mobile.visit_share;
  desktop.percent = desktop.visit_share;

  return {
    total: totalVisitors,
    purchases_total: totalPurchases,
    mobile,
    desktop,
    completion_split: {
      mobile: mobile.purchases,
      desktop: desktop.purchases,
      mobile_percent: mobile.purchase_share,
      desktop_percent: desktop.purchase_share,
    },
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
    top_sizes: [],
    top_material_sizes: [],
    top_paths: [],
    devices: {
      total: 0,
      purchases_total: 0,
      mobile: {
        visitors: 0,
        uploads: 0,
        reached_review: 0,
        added_to_cart: 0,
        purchases: 0,
        percent: 0,
        visit_share: 0,
        purchase_share: 0,
        upload_rate: 0,
        cart_rate: 0,
        completion_rate: 0,
      },
      desktop: {
        visitors: 0,
        uploads: 0,
        reached_review: 0,
        added_to_cart: 0,
        purchases: 0,
        percent: 0,
        visit_share: 0,
        purchase_share: 0,
        upload_rate: 0,
        cart_rate: 0,
        completion_rate: 0,
      },
      completion_split: {
        mobile: 0,
        desktop: 0,
        mobile_percent: 0,
        desktop_percent: 0,
      },
    },
    last_events: [],
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readSupabaseProjectRef() {
  try {
    const { SUPABASE_URL } = getEnv();
    const match = String(SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

async function fetchTrackEvents(supabase, fromIso, toIso) {
  const rpcResult = await supabase.rpc('analytics_fetch_track_events', {
    p_from: fromIso,
    p_to: toIso,
  });

  if (!rpcResult.error && Array.isArray(rpcResult.data)) {
    return { rows: rpcResult.data, error: null, source: 'rpc' };
  }

  const tableResult = await supabase
    .from('track_events')
    .select('rid, event_name, cta_type, design_slug, extra, user_agent, created_at')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: false })
    .limit(10000);

  if (!tableResult.error && Array.isArray(tableResult.data)) {
    return { rows: tableResult.data, error: null, source: 'table' };
  }

  return {
    rows: [],
    error: tableResult.error || rpcResult.error,
    source: 'failed',
  };
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

  const { rows, error, source } = await fetchTrackEvents(supabase, fromIso, toIso);

  if (error) {
    const warningDetail = [error?.code, error?.message].filter(Boolean).join(': ') || String(error);
    const projectRef = readSupabaseProjectRef();
    logger.error?.('analytics_dashboard_query_failed', {
      diagId,
      error: warningDetail,
      source,
      projectRef,
    });
    const payload = emptyDashboard(fromIso, toIso, diagId, 'track_events_unavailable');
    payload.warning_detail = projectRef
      ? `${warningDetail} (proyecto API: ${projectRef})`
      : warningDetail;
    sendJson(res, 200, payload);
    return;
  }

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
  const sizeCounts = new Map();
  const materialSizeCounts = new Map();
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

    if (rid && !deviceByRid.has(rid)) {
      deviceByRid.set(rid, classifyDevice(row.extra, row.user_agent));
    }

    if (VISIT_EVENTS.has(eventName) && rid) {
      visitSet.add(rid);
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
    if (isPreferenceEvent(eventName)) {
      const width = readExtraNumber(row.extra, 'width_cm');
      const height = readExtraNumber(row.extra, 'height_cm');
      const sizeLabel = formatSizeLabel(width, height);

      if (material) {
        materialCounts.set(material, (materialCounts.get(material) ?? 0) + 1);
      }
      if (sizeLabel) {
        sizeCounts.set(sizeLabel, (sizeCounts.get(sizeLabel) ?? 0) + 1);
      }
      if (material && sizeLabel) {
        const comboLabel = `${material} · ${sizeLabel}`;
        materialSizeCounts.set(comboLabel, (materialSizeCounts.get(comboLabel) ?? 0) + 1);
      }
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

  const topSizes = Array.from(sizeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([size, count]) => ({ size, count }));

  const topMaterialSizes = Array.from(materialSizeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }));

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
    top_sizes: topSizes,
    top_material_sizes: topMaterialSizes,
    top_paths: topPaths,
    devices: buildDeviceBreakdown(deviceByRid, {
      visits: visitSet,
      uploads: uploadSet,
      review: reviewSet,
      cart: cartSet,
      purchases: purchaseSet,
    }),
    last_events: rows.slice(0, 50).map((row) => ({
      rid: row.rid,
      event_name: row.event_name,
      created_at: row.created_at,
      design_slug: row.design_slug,
    })),
  });
}

export default analyticsDashboard;
