import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import { createDiagId, logApiError } from '../_lib/diag.js';
import { applyAnalyticsCors } from './_lib/cors.ts';

export const config = { maxDuration: 10 };

const EVENT_NAMES = {
  view: 'mockup_view',
  options: 'view_purchase_options',
  public: 'cta_click_public',
  private: 'cta_click_private',
  cart: 'cta_click_cart',
  purchase: 'purchase_completed',
} as const;

const CTA_TYPES = new Set(['public', 'private', 'cart']);
const ALL_EVENTS = Object.values(EVENT_NAMES);

type DateLike = string | string[] | undefined;

type TrackEventRow = {
  rid: string | null;
  event_name: string | null;
  cta_type: string | null;
  design_slug: string | null;
};

function parseDateParam(raw: DateLike): Date | null {
  if (Array.isArray(raw)) {
    return parseDateParam(raw[0]);
  }

  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function normalizeRid(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function intersectCount(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) {
    return 0;
  }
  let total = 0;
  for (const value of a) {
    if (b.has(value)) {
      total += 1;
    }
  }
  return total;
}

function formatRate(numerator: number, denominator: number): number {
  if (!denominator) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function resolveCtaType(eventName: string | null | undefined, rawCta: string | null | undefined) {
  const normalized = typeof rawCta === 'string' ? rawCta.trim().toLowerCase() : '';
  if (normalized && CTA_TYPES.has(normalized)) {
    return normalized;
  }

  if (typeof eventName === 'string' && eventName.startsWith('cta_click_')) {
    const suffix = eventName.replace('cta_click_', '').trim().toLowerCase();
    if (CTA_TYPES.has(suffix)) {
      return suffix;
    }
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = createDiagId();
  res.setHeader('X-Diag-Id', diagId);
  const { decision } = applyAnalyticsCors(req, res);

  if (req.method === 'OPTIONS') {
    if (!decision.allowed) {
      res.status(403).json({ ok: false, error: 'origin_not_allowed', diagId });
      return;
    }
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  if (!decision.allowed) {
    res.status(403).json({ ok: false, error: 'origin_not_allowed', diagId });
    return;
  }

  const expectedToken = process.env.ADMIN_ANALYTICS_TOKEN;
  if (!expectedToken) {
    res.status(200).json({ ok: false, error: 'missing_env', diagId });
    return;
  }

  const rawTokenHeader = req.headers['x-admin-token'];
  const providedToken = Array.isArray(rawTokenHeader) ? rawTokenHeader[0] : rawTokenHeader;
  if (!providedToken || providedToken !== expectedToken) {
    res.status(401).json({ ok: false, error: 'unauthorized', diagId });
    return;
  }

  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    logApiError('analytics-flows', { diagId, step: 'init_supabase', error });
    res.status(200).json({ ok: false, error: 'missing_env', diagId });
    return;
  }

  const now = new Date();
  const toParam = parseDateParam(req.query?.to);
  const toDate = toParam && !Number.isNaN(toParam.valueOf()) ? toParam : now;
  const fromParam = parseDateParam(req.query?.from);
  const defaultFrom = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  let fromDate = fromParam && !Number.isNaN(fromParam.valueOf()) ? fromParam : defaultFrom;

  if (fromDate > toDate) {
    fromDate = defaultFrom;
  }

  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();

  try {
    const { data, error } = await supabase
      .from('track_events')
      .select('rid, event_name, cta_type, design_slug')
      .in('event_name', ALL_EVENTS)
      .gte('created_at', fromIso)
      .lte('created_at', toIso);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? (data as TrackEventRow[]) : [];

    const viewSet = new Set<string>();
    const optionsSet = new Set<string>();
    const purchaseSet = new Set<string>();
    const clickSet = new Set<string>();
    const ctaSets: Record<'public' | 'private' | 'cart', Set<string>> = {
      public: new Set<string>(),
      private: new Set<string>(),
      cart: new Set<string>(),
    };
    const designCounters = new Map<string, number>();

    for (const row of rows) {
      const rid = normalizeRid(row?.rid);
      if (!rid) {
        continue;
      }

      const eventName = row?.event_name ?? '';
      if (eventName === EVENT_NAMES.view) {
        viewSet.add(rid);
      } else if (eventName === EVENT_NAMES.options) {
        optionsSet.add(rid);
      } else if (eventName === EVENT_NAMES.purchase) {
        purchaseSet.add(rid);
      } else if (
        eventName === EVENT_NAMES.public
        || eventName === EVENT_NAMES.private
        || eventName === EVENT_NAMES.cart
      ) {
        clickSet.add(rid);
        const ctaType = resolveCtaType(eventName, row?.cta_type ?? null);
        if (ctaType && ctaSets[ctaType as 'public' | 'private' | 'cart']) {
          ctaSets[ctaType as 'public' | 'private' | 'cart'].add(rid);
        }
        const designSlug = normalizeRid(row?.design_slug);
        if (designSlug) {
          designCounters.set(designSlug, (designCounters.get(designSlug) ?? 0) + 1);
        }
      }
    }

    const viewToOptions = intersectCount(viewSet, optionsSet);
    const optionsToClicks = intersectCount(optionsSet, clickSet);
    const clicksToPurchase = intersectCount(clickSet, purchaseSet);
    const viewToPurchase = intersectCount(viewSet, purchaseSet);

    const totals = {
      view: viewSet.size,
      options: optionsSet.size,
      clicks: clickSet.size,
      purchase: purchaseSet.size,
      view_to_options: viewToOptions,
      options_to_clicks: optionsToClicks,
      clicks_to_purchase: clicksToPurchase,
      view_to_purchase: viewToPurchase,
    };

    const rates = {
      view_to_options: formatRate(viewToOptions, viewSet.size),
      options_to_clicks: formatRate(optionsToClicks, optionsSet.size),
      clicks_to_purchase: formatRate(clicksToPurchase, clickSet.size),
      view_to_purchase: formatRate(viewToPurchase, viewSet.size),
    };

    const publicPurchases = intersectCount(ctaSets.public, purchaseSet);
    const privatePurchases = intersectCount(ctaSets.private, purchaseSet);
    const cartPurchases = intersectCount(ctaSets.cart, purchaseSet);

    const ctas = {
      public: {
        clicks: ctaSets.public.size,
        purchases: publicPurchases,
        rate: formatRate(publicPurchases, ctaSets.public.size),
      },
      private: {
        clicks: ctaSets.private.size,
        purchases: privatePurchases,
        rate: formatRate(privatePurchases, ctaSets.private.size),
      },
      cart: {
        clicks: ctaSets.cart.size,
        purchases: cartPurchases,
        rate: formatRate(cartPurchases, ctaSets.cart.size),
      },
    };

    const topDesigns = Array.from(designCounters.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([design_slug, clicks]) => ({ design_slug, clicks }));

    console.log('[analytics-flows]', { diagId });

    res.status(200).json({
      ok: true,
      diagId,
      from: fromIso,
      to: toIso,
      totals,
      rates,
      ctas,
      topDesigns,
    });
  } catch (error) {
    logApiError('analytics-flows', { diagId, step: 'query', error });
    res.status(200).json({ ok: false, error: 'analytics_failed', diagId });
  }
}
