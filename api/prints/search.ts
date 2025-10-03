import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDiagId, logApiError } from '../_lib/diag.js';
import { applyLenientCors } from '../_lib/lenientCors.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MIN_LIMIT = 1;
const DEFAULT_OFFSET = 0;
const SUPABASE_TIMEOUT_MS = 15000;
const PRINTS_TABLE = 'prints';

type PrintRow = {
  id?: string | number;
  title?: string | null;
  slug?: string | null;
  thumb_url?: string | null;
  thumbUrl?: string | null;
  tags?: string | string[] | null;
  price?: number | string | null;
  popularity?: number | null;
  created_at?: string | null;
  createdAt?: string | null;
};

type SearchResultItem = {
  id: string | number | null;
  title: string | null;
  slug: string | null;
  thumbUrl: string | null;
  tags: string[] | string | null;
  price: number | string | null;
  popularity: number | null;
  createdAt: string | null;
};

let cachedClient: SupabaseClient | null = null;

function resolveSupabaseKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
}

function hasSupabaseConfig(): boolean {
  return Boolean(process.env.SUPABASE_URL && resolveSupabaseKey());
}

function getSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    const url = process.env.SUPABASE_URL!;
    const key = resolveSupabaseKey()!;
    cachedClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}

function parseLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const num = Number(raw);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  const int = Math.floor(num);
  if (int < MIN_LIMIT) return MIN_LIMIT;
  if (int > MAX_LIMIT) return MAX_LIMIT;
  return int;
}

function parseOffset(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return DEFAULT_OFFSET;
  return Math.floor(num);
}

function normalizeQuery(value: unknown): string {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function escapeForIlike(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    if (typeof error.message === 'string' && error.message.toLowerCase().includes('aborted')) {
      return true;
    }
  }
  return false;
}

function mapRowToItem(row: PrintRow): SearchResultItem {
  const thumb = row.thumbUrl ?? row.thumb_url ?? null;
  const created = row.createdAt ?? row.created_at ?? null;
  return {
    id: (row.id as string | number | null) ?? null,
    title: row.title ?? null,
    slug: row.slug ?? null,
    thumbUrl: thumb,
    tags: row.tags ?? null,
    price: row.price ?? null,
    popularity: typeof row.popularity === 'number' ? row.popularity : null,
    createdAt: created,
  };
}

async function searchPrints(
  client: SupabaseClient,
  query: string,
  limit: number,
  offset: number,
): Promise<{ items: SearchResultItem[]; total: number }> {
  const pattern = `%${escapeForIlike(query)}%`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
  try {
    const { data, error, count } = await client
      .from(PRINTS_TABLE)
      .select('id, title, slug, thumb_url, price, popularity, created_at, tags', { count: 'exact' })
      .or(`title.ilike.${pattern},tags.ilike.${pattern},slug.ilike.${pattern}`)
      .order('popularity', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)
      .abortSignal(controller.signal);

    if (error) {
      const err = new Error(error.message);
      (err as Error & { code?: string }).code = 'SUPABASE_DB_ERROR';
      (err as Error & { cause?: unknown }).cause = error;
      throw err;
    }

    const rows = Array.isArray(data) ? data : [];
    const items = rows.map(mapRowToItem);
    const total = typeof count === 'number' && Number.isFinite(count) ? count : items.length;
    return { items, total };
  } finally {
    clearTimeout(timeout);
  }
}

export const config = { maxDuration: 20 };

function applySearchCors(req: VercelRequest, res: VercelResponse) {
  applyLenientCors(req as any, res as any);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

function sendOptionsResponse(req: VercelRequest, res: VercelResponse) {
  applySearchCors(req, res);
  if (typeof res.status === 'function') {
    res.status(200);
  } else {
    res.statusCode = 200;
  }
  res.end();
}

function sendJsonResponse(req: VercelRequest, res: VercelResponse, status: number, payload: unknown) {
  applySearchCors(req, res);
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  const body = payload == null ? {} : payload;
  if (typeof res.json === 'function') {
    res.json(body);
    return;
  }
  res.end(JSON.stringify(body));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = createDiagId();
  res.setHeader('X-Diag-Id', diagId);

  if (req.method === 'OPTIONS') {
    sendOptionsResponse(req, res);
    return;
  }

  if ((req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    sendJsonResponse(req, res, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  const rawQuery = normalizeQuery(req.query?.query);
  if (!rawQuery) {
    sendJsonResponse(req, res, 400, { ok: false, error: 'missing_query', diagId });
    return;
  }

  const limit = parseLimit(req.query?.limit);
  const offset = parseOffset(req.query?.offset);

  if (!hasSupabaseConfig()) {
    sendJsonResponse(req, res, 200, {
      ok: true,
      items: [],
      total: 0,
      limit,
      offset,
      diagId,
      mode: 'stub',
    });
    return;
  }

  let client: SupabaseClient;
  try {
    client = getSupabaseClient();
  } catch (err) {
    logApiError('prints-search', { diagId, step: 'init_client', error: err });
    sendJsonResponse(req, res, 200, { ok: false, error: 'search_failed', diagId });
    return;
  }

  try {
    const { items, total } = await searchPrints(client, rawQuery, limit, offset);
    sendJsonResponse(req, res, 200, {
      ok: true,
      items,
      total,
      limit,
      offset,
      diagId,
    });
  } catch (err) {
    if (isAbortError(err)) {
      logApiError('prints-search', { diagId, step: 'timeout', error: err });
      sendJsonResponse(req, res, 200, { ok: false, error: 'timeout', diagId });
      return;
    }

    const code = (err as Error & { code?: string })?.code;
    const errorCode = code === 'SUPABASE_DB_ERROR' ? 'db_error' : 'search_failed';
    logApiError('prints-search', { diagId, step: errorCode, error: err });
    sendJsonResponse(req, res, 200, { ok: false, error: errorCode, diagId });
  }
}
