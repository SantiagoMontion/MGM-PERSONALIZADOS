import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import { createDiagId, logApiError } from '../_lib/diag.js';
import { getAllowedOriginsFromEnv, resolveCorsDecision } from '../_lib/cors.ts';
import { ANALYTICS_CORS_HEADERS, verifyAnalyticsAccess } from '../_lib/analyticsAuth.ts';

export const config = { maxDuration: 15 };

type DateLike = string | string[] | undefined;

type TrackEventRow = {
  rid: string | null;
  event_name: string | null;
  cta_type: string | null;
  design_slug: string | null;
  extra: Record<string, unknown> | null;
  created_at: string | null;
};

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
} as const;

function parseDateParam(raw: DateLike): Date | null {
  if (Array.isArray(raw)) return parseDateParam(raw[0]);
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function normalizeRid(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function intersectCount(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let total = 0;
  for (const value of a) {
    if (b.has(value)) total += 1;
  }
  return total;
}

function formatRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function readExtraString(extra: Record<string, unknown> | null, key: string): string | null {
  if (!extra || typeof extra !== 'object') return null;
  const value = extra[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function toDateKey(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headersWithGet = req.headers as VercelRequest['headers'] & {
    get?: (name: string) => string | null;
  };
  const originHeader =
    headersWithGet.get?.('origin')
    ?? (Array.isArray(headersWithGet.origin) ? headersWithGet.origin[0] : headersWithGet.origin);
  const origin = originHeader ?? '*';
  const baseHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': ANALYTICS_CORS_HEADERS,
    'Access-Control-Expose-Headers': 'X-Diag-Id',
    Vary: 'Origin',
  };

  if (req.method === 'OPTIONS') {
    for (const [key, value] of Object.entries(baseHeaders)) {
      res.setHeader(key, value);
    }
    res.status(204).end();
    return;
  }

  const diagId = createDiagId();
  res.setHeader('X-Diag-Id', diagId);

  if (req.method !== 'GET') {
    return sendResponse(res, Response.json(
      { ok: false, error: 'method_not_allowed', diagId },
      { status: 405, headers: baseHeaders },
    ));
  }

  const allowList = getAllowedOriginsFromEnv();
  const allowAll = allowList.length === 0;
  const decision = allowAll
    ? null
    : resolveCorsDecision(typeof originHeader === 'string' ? originHeader : undefined, allowList);
  const isAllowed = allowAll || Boolean(decision?.allowed);

  if (!isAllowed) {
    return sendResponse(res, Response.json(
      { ok: false, error: 'forbidden_origin', diagId },
      { status: 403, headers: baseHeaders },
    ));
  }

  for (const [key, value] of Object.entries(baseHeaders)) {
    res.setHeader(key, value);
  }

  try {
    const auth = verifyAnalyticsAccess(req);
    if (!auth.ok) {
      return sendResponse(res, Response.json(
        { ok: false, error: auth.error || 'unauthorized', diagId },
        { status: 401, headers: baseHeaders },
      ));
    }

    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseAdmin();
    } catch (error) {
      logApiError('analytics-dashboard', { diagId, step: 'init_supabase', error });
      return sendResponse(res, Response.json(
        { ok: false, error: 'missing_env', diagId },
        { status: 200, headers: baseHeaders },
      ));
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

    const { data, error } = await supabase
      .from('track_events')
      .select('rid, event_name, cta_type, design_slug, extra, created_at')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (error) {
      throw Object.assign(error instanceof Error ? error : new Error(JSON.stringify(error)), { step: 'query' });
    }

    const rows = Array.isArray(data) ? (data as TrackEventRow[]) : [];

    const visitSet = new Set<string>();
    const uploadSet = new Set<string>();
    const editSet = new Set<string>();
    const continueSet = new Set<string>();
    const reviewSet = new Set<string>();
    const cartSet = new Set<string>();
    const purchaseSet = new Set<string>();

    const mockupViewSet = new Set<string>();
    const mockupOptionsSet = new Set<string>();
    const mockupClickSet = new Set<string>();

    const eventCounts = new Map<string, { total: number; rids: Set<string> }>();
    const dailyMap = new Map<string, { visitors: Set<string>; pageViews: number }>();
    const materialCounts = new Map<string, number>();
    const pathCounts = new Map<string, number>();

    for (const row of rows) {
      const rid = normalizeRid(row?.rid);
      const eventName = row?.event_name ?? '';
      if (!eventName) continue;

      if (!eventCounts.has(eventName)) {
        eventCounts.set(eventName, { total: 0, rids: new Set() });
      }
      const counter = eventCounts.get(eventName)!;
      counter.total += 1;
      if (rid) counter.rids.add(rid);

      if (VISIT_EVENTS.has(eventName) && rid) {
        visitSet.add(rid);
        const dateKey = toDateKey(row.created_at);
        if (dateKey) {
          if (!dailyMap.has(dateKey)) {
            dailyMap.set(dateKey, { visitors: new Set(), pageViews: 0 });
          }
          const day = dailyMap.get(dateKey)!;
          day.visitors.add(rid);
          day.pageViews += 1;
        }
        const path = readExtraString(row.extra, 'path');
        if (path) {
          pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
        }
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
      visit: {
        label: 'Visitas',
        rids: visitSet.size,
        rate_from_previous: null,
        drop_off_from_previous: null,
      },
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

    const lastEvents = rows.slice(0, 50).map((row) => ({
      rid: row.rid,
      event_name: row.event_name,
      created_at: row.created_at,
      design_slug: row.design_slug,
    }));

    return sendResponse(res, Response.json({
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
      last_events: lastEvents,
    }, { status: 200, headers: baseHeaders }));
  } catch (error) {
    const step = typeof error === 'object' && error && 'step' in error
      ? String((error as { step: string }).step)
      : 'unhandled';
    logApiError('analytics-dashboard', { diagId, step, error });
    return sendResponse(res, Response.json(
      { ok: false, error: String(error), diagId },
      { status: 500, headers: baseHeaders },
    ));
  }
}

async function sendResponse(res: VercelResponse, response: Response) {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (response.status === 204) {
    res.end();
    return;
  }
  const body = await response.text();
  if (body.length > 0) {
    res.send(body);
  } else {
    res.end();
  }
}
