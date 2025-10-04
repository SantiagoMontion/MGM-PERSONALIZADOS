import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logApiError } from './_lib/diag.js';

const ALLOWED_EVENTS = new Set<string>([
  'mockup_view',
  'view_purchase_options',
  'continue_design',
  'checkout_public_click',
  'checkout_private_click',
  'add_to_cart_click',
  'publish_product_ok',
  'checkout_started_ok',
  'purchase_completed',
]);

const DUPLICATE_WINDOW_MS = 2000;

let cachedClient: SupabaseClient | null = null;

function resolveAllowedOrigin(originHeader: string | undefined): string | undefined {
  const allowList = new Set<string>();

  const frontOrigin = typeof process.env.FRONT_ORIGIN === 'string' ? process.env.FRONT_ORIGIN.trim() : '';
  if (frontOrigin) {
    allowList.add(frontOrigin);
  }

  const envOrigins = typeof process.env.ALLOWED_ORIGINS === 'string' ? process.env.ALLOWED_ORIGINS.split(',') : [];
  for (const entry of envOrigins) {
    const trimmed = entry.trim();
    if (trimmed) {
      allowList.add(trimmed);
    }
  }

  if (originHeader && allowList.has(originHeader)) {
    return originHeader;
  }

  if (frontOrigin) {
    return frontOrigin;
  }

  return allowList.values().next().value;
}

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const allowedOrigin = resolveAllowedOrigin(originHeader);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
}

function ensureClient(): SupabaseClient {
  if (!cachedClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing Supabase configuration');
    }
    cachedClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}

function parseBody(req: VercelRequest): Record<string, any> {
  const { body } = req;
  if (!body) return {};

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed === 'object' && parsed ? (parsed as Record<string, any>) : {};
    } catch {
      return {};
    }
  }

  if (typeof body === 'object') {
    return body as Record<string, any>;
  }

  return {};
}

function normalizeString(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeString(entry);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function normalizeDetails(value: unknown): Record<string, any> {
  if (value == null) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      return {};
    }
    return {};
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  return {};
}

function normalizeNumber(value: unknown): number | null {
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

async function isDuplicateEvent(
  client: SupabaseClient,
  rid: string | null,
  eventName: string,
): Promise<boolean> {
  if (!rid) {
    return false;
  }

  const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  try {
    const { data, error } = await client
      .from('events')
      .select('id')
      .eq('rid', rid)
      .eq('event_name', eventName)
      .gte('ts', windowStart)
      .limit(1);

    if (error) {
      throw error;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    logApiError('track.dedupe_failed', { error });
    return false;
  }
}

async function insertEvent(client: SupabaseClient, payload: Record<string, any>, req: VercelRequest) {
  const eventName = normalizeString(payload.event_name);
  if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
    return 'ignored';
  }

  const rid = normalizeString(payload.rid);
  const shouldSkip = await isDuplicateEvent(client, rid, eventName);
  if (shouldSkip) {
    return 'ignored';
  }

  const details = normalizeDetails(payload.details);
  const userAgent = normalizeString(req.headers['user-agent']);
  const referer = normalizeString(req.headers.referer || req.headers['referrer']);

  const insertPayload = {
    event_name: eventName,
    rid,
    design_slug: normalizeString(payload.design_slug),
    product_id: normalizeString(payload.product_id),
    variant_id: normalizeString(payload.variant_id),
    amount: normalizeNumber(payload.amount),
    currency: normalizeString(payload.currency),
    order_id: normalizeString(payload.order_id),
    origin: normalizeString(payload.origin),
    user_agent: userAgent,
    referer,
    details,
  };

  try {
    const { error } = await client.from('events').insert(insertPayload);
    if (error) {
      throw error;
    }
    return 'inserted';
  } catch (error) {
    logApiError('track.insert_failed', { error });
    return 'error';
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: true });
    return;
  }

  if (process.env.TRACKING_ENABLED === '0') {
    res.status(204).end();
    return;
  }

  let client: SupabaseClient;
  try {
    client = ensureClient();
  } catch (error) {
    logApiError('track.supabase_config_missing', { error });
    res.status(200).json({ ok: true });
    return;
  }

  const body = parseBody(req);
  const eventName = normalizeString(body.event_name);
  if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
    res.status(204).end();
    return;
  }

  const result = await insertEvent(client, body, req);

  if (result === 'inserted') {
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ ok: true });
}
