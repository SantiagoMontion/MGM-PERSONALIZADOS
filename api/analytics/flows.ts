import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import { createDiagId, logApiError } from '../_lib/diag.js';
import { applyLenientCors } from '../_lib/lenientCors.js';

export const config = { maxDuration: 10 };

const EVENT_NAMES = {
  public: 'cta_click_public',
  private: 'cta_click_private',
  cart: 'cta_click_cart',
  purchase: 'purchase_completed',
} as const;

const CTA_EVENTS = [EVENT_NAMES.public, EVENT_NAMES.private, EVENT_NAMES.cart];

interface FlowTotals {
  clicks: number;
  purchasers: number;
  rate: number;
}

interface TopDesign {
  design_slug: string;
  clicks: number;
}

type DateLike = string | string[] | undefined;

type EventRow = {
  rid: string | null;
};

type TopDesignRow = {
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

function formatRate(purchasers: number, clicks: number): number {
  if (!clicks) {
    return 0;
  }
  return Number(((purchasers / clicks) * 100).toFixed(2));
}

function intersectCount(a: Set<string>, b: Set<string>): number {
  let total = 0;
  for (const value of a) {
    if (b.has(value)) {
      total += 1;
    }
  }
  return total;
}

function asRidSet(rows: EventRow[] | null | undefined): Set<string> {
  const result = new Set<string>();
  if (!rows) {
    return result;
  }
  for (const row of rows) {
    if (typeof row?.rid === 'string' && row.rid.trim()) {
      result.add(row.rid);
    }
  }
  return result;
}

async function fetchRidSet(
  supabase: SupabaseClient,
  eventName: string,
  fromIso: string,
  toIso: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('track_events')
    .select('rid')
    .eq('event_name', eventName)
    .gte('created_at', fromIso)
    .lte('created_at', toIso);

  if (error) {
    throw error;
  }

  return asRidSet((data as EventRow[]) ?? []);
}

async function fetchTopDesigns(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
): Promise<TopDesign[]> {
  const { data, error } = await supabase
    .from('track_events')
    .select('design_slug')
    .in('event_name', CTA_EVENTS)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .not('design_slug', 'is', null);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? (data as TopDesignRow[]) : [];
  if (!rows.length) {
    return [];
  }

  const counters = new Map<string, number>();
  for (const row of rows) {
    if (typeof row?.design_slug === 'string' && row.design_slug.trim()) {
      const current = counters.get(row.design_slug) ?? 0;
      counters.set(row.design_slug, current + 1);
    }
  }

  return Array.from(counters.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([design_slug, clicks]) => ({ design_slug, clicks }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = createDiagId();
  res.setHeader('X-Diag-Id', diagId);
  applyLenientCors(req, res);

  if (req.method === 'OPTIONS') {
    const requestedHeaders = req.headers['access-control-request-headers'];
    if (requestedHeaders) {
      const rawList = Array.isArray(requestedHeaders)
        ? requestedHeaders.join(',')
        : requestedHeaders;
      const names = rawList
        .split(',')
        .map((name) => name.split(':')[0].trim().toLowerCase())
        .filter(Boolean);
      const headerSet = new Set(names);
      headerSet.add('content-type');
      headerSet.add('x-admin-token');
      res.setHeader('Access-Control-Allow-Headers', Array.from(headerSet).join(', '));
    } else {
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-admin-token');
    }
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  const rawTokenHeader = req.headers['x-admin-token'];
  const providedToken = Array.isArray(rawTokenHeader) ? rawTokenHeader[0] : rawTokenHeader;
  const expectedToken = process.env.ANALYTICS_ADMIN_TOKEN;

  if (!providedToken || !expectedToken || providedToken !== expectedToken) {
    res.status(401).json({ ok: false, error: 'unauthorized', diagId });
    return;
  }

  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    logApiError('analytics-flows', { diagId, step: 'init_supabase', error: err });
    res.status(200).json({ ok: false, error: 'missing_env', diagId });
    return;
  }

  const rawTo = parseDateParam(req.query?.to);
  const now = new Date();
  const toDate = rawTo && !Number.isNaN(rawTo.valueOf()) ? rawTo : now;
  const rawFrom = parseDateParam(req.query?.from);
  const defaultFrom = new Date(toDate.getTime());
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  let fromDate = rawFrom && !Number.isNaN(rawFrom.valueOf()) ? rawFrom : defaultFrom;

  if (fromDate > toDate) {
    fromDate = defaultFrom;
  }

  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();

  try {
    const [publicRids, privateRids, cartRids, purchaseRids] = await Promise.all([
      fetchRidSet(supabase, EVENT_NAMES.public, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.private, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.cart, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.purchase, fromIso, toIso),
    ]);

    const publicPurchasers = intersectCount(publicRids, purchaseRids);
    const privatePurchasers = intersectCount(privateRids, purchaseRids);
    const cartPurchasers = intersectCount(cartRids, purchaseRids);

    const totals: Record<'public' | 'private' | 'cart', FlowTotals> = {
      public: {
        clicks: publicRids.size,
        purchasers: publicPurchasers,
        rate: formatRate(publicPurchasers, publicRids.size),
      },
      private: {
        clicks: privateRids.size,
        purchasers: privatePurchasers,
        rate: formatRate(privatePurchasers, privateRids.size),
      },
      cart: {
        clicks: cartRids.size,
        purchasers: cartPurchasers,
        rate: formatRate(cartPurchasers, cartRids.size),
      },
    };

    let topDesigns: TopDesign[] = [];
    try {
      topDesigns = await fetchTopDesigns(supabase, fromIso, toIso);
    } catch (err) {
      logApiError('analytics-flows', { diagId, step: 'top_designs', error: err });
    }

    res.status(200).json({
      ok: true,
      window: {
        from: fromIso,
        to: toIso,
      },
      totals,
      topDesigns,
      diagId,
    });
  } catch (err) {
    logApiError('analytics-flows', { diagId, step: 'query', error: err });
    res.status(200).json({ ok: false, error: 'analytics_failed', diagId });
  }
}
