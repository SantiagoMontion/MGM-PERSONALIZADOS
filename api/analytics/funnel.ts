import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import { createDiagId, logApiError } from '../_lib/diag.js';
import { applyLenientCors } from '../_lib/lenientCors.js';

export const config = { maxDuration: 10 };

type DateLike = string | string[] | undefined;

type EventRow = {
  rid: string | null;
};

const EVENT_NAMES = {
  view: 'mockup_view',
  continue: 'continue_design',
  options: 'view_purchase_options',
  publicClick: 'checkout_public_click',
  privateClick: 'checkout_private_click',
  cartClick: 'add_to_cart_click',
  purchase: 'purchase_completed',
} as const;

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

function formatRate(numerator: number, denominator: number): number {
  if (!denominator) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
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

function unionSets(...sets: Set<string>[]): Set<string> {
  const result = new Set<string>();
  for (const set of sets) {
    for (const value of set) {
      result.add(value);
    }
  }
  return result;
}

function intersectCount(a: Set<string>, b: Set<string>): number {
  let total = 0;
  if (a.size === 0 || b.size === 0) {
    return total;
  }

  for (const value of a) {
    if (b.has(value)) {
      total += 1;
    }
  }

  return total;
}

async function fetchRidSet(
  supabase: SupabaseClient,
  eventName: string,
  fromIso: string,
  toIso: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('events')
    .select('rid')
    .eq('event_name', eventName)
    .gte('ts', fromIso)
    .lte('ts', toIso);

  if (error) {
    throw error;
  }

  return asRidSet((data as EventRow[]) ?? []);
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

  const expectedToken = process.env.ANALYTICS_ADMIN_TOKEN;
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
  } catch (err) {
    logApiError('analytics-funnel', { diagId, step: 'init_supabase', error: err });
    res.status(200).json({ ok: false, error: 'missing_env', diagId });
    return;
  }

  const now = new Date();
  const rawTo = parseDateParam(req.query?.to);
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
    const [
      viewSet,
      continueSet,
      optionsSet,
      publicClickSet,
      privateClickSet,
      cartClickSet,
      purchaseSet,
    ] = await Promise.all([
      fetchRidSet(supabase, EVENT_NAMES.view, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.continue, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.options, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.publicClick, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.privateClick, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.cartClick, fromIso, toIso),
      fetchRidSet(supabase, EVENT_NAMES.purchase, fromIso, toIso),
    ]);

    const clickSet = unionSets(publicClickSet, privateClickSet, cartClickSet);

    const viewCount = viewSet.size;
    const continueCount = continueSet.size;
    const optionsCount = optionsSet.size;
    const clickCount = clickSet.size;
    const purchaseCount = purchaseSet.size;

    const publicPurchasers = intersectCount(publicClickSet, purchaseSet);
    const privatePurchasers = intersectCount(privateClickSet, purchaseSet);
    const cartPurchasers = intersectCount(cartClickSet, purchaseSet);

    res.status(200).json({
      ok: true,
      window: {
        from: fromIso,
        to: toIso,
      },
      stages: {
        view: {
          rids: viewCount,
        },
        continue: {
          rids: continueCount,
          rate_from_view: formatRate(continueCount, viewCount),
        },
        options: {
          rids: optionsCount,
          rate_from_continue: formatRate(optionsCount, continueCount),
        },
        clicks: {
          rids: clickCount,
          rate_from_options: formatRate(clickCount, optionsCount),
        },
        purchase: {
          rids: purchaseCount,
          rate_from_clicks: formatRate(purchaseCount, clickCount),
        },
      },
      cta: {
        public: {
          clicks: publicClickSet.size,
          purchasers: publicPurchasers,
          rate: formatRate(publicPurchasers, publicClickSet.size),
        },
        private: {
          clicks: privateClickSet.size,
          purchasers: privatePurchasers,
          rate: formatRate(privatePurchasers, privateClickSet.size),
        },
        cart: {
          clicks: cartClickSet.size,
          purchasers: cartPurchasers,
          rate: formatRate(cartPurchasers, cartClickSet.size),
        },
      },
      diagId,
    });
  } catch (err) {
    logApiError('analytics-funnel', { diagId, step: 'query', error: err });
    res.status(200).json({ ok: false, error: 'funnel_failed', diagId });
  }
}
