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
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_ROOT = '';

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

type StorageListError = { prefix: string; message: string };

type StorageFileEntry = {
  name: string;
  path: string;
  updated_at?: string | null;
  metadata?: { size?: number | null } | null;
};

type StorageSearchResult = {
  items: Array<{
    name: string;
    path: string;
    size: number | null;
    updatedAt: string | null;
    url: string | null;
  }>;
  total: number;
  scannedDirs: number;
  scannedFiles: number;
  errors: StorageListError[];
};

type StorageSearchFailure = 'storage_list_failed' | 'timeout';

const MATCH_NORMALIZER = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

let cachedClient: SupabaseClient | null = null;

function resolveSupabaseKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY
  );
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

function parseDebug(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  if (typeof raw === 'number') {
    return raw === 1;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  return false;
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

function normalizeStorageRoot(root: string | undefined): string {
  if (!root) return '';
  const trimmed = root.trim();
  if (!trimmed) return '';
  const withoutLeading = trimmed.replace(/^\/+/, '');
  const withoutTrailing = withoutLeading.replace(/\/+$/, '');
  if (!withoutTrailing) return '';
  return withoutTrailing.replace(/\/+/g, '/');
}

function buildChildPrefix(prefix: string, name: string): string {
  const cleanName = name.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleanName) return prefix;

  return prefix ? `${prefix}/${cleanName}`.replace(/\/+/g, '/') : cleanName;

}

function buildFilePath(prefix: string, name: string): string {
  const cleanName = name.replace(/^\/+/, '');

  if (!cleanName) return prefix;
  return prefix ? `${prefix}/${cleanName}`.replace(/\/+/g, '/') : cleanName;

}

function isPdfFile(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

function filterStorageFiles(files: StorageFileEntry[], query: string): StorageFileEntry[] {
  const normalizedQuery = MATCH_NORMALIZER(query);
  return files.filter((file) => {
    if (!isPdfFile(file.name)) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    try {
      return MATCH_NORMALIZER(file.name).includes(normalizedQuery);
    } catch (err) {
      return file.name.toLowerCase().includes(normalizedQuery);
    }
  });
}

function getUpdatedAtTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function sortStorageFiles(files: StorageFileEntry[]): StorageFileEntry[] {
  return [...files].sort((a, b) => {
    const aUpdated = getUpdatedAtTimestamp(a.updated_at ?? null);
    const bUpdated = getUpdatedAtTimestamp(b.updated_at ?? null);
    if (aUpdated != null && bUpdated != null && aUpdated !== bUpdated) {
      return bUpdated - aUpdated;
    }
    if (aUpdated != null && bUpdated == null) {
      return -1;
    }
    if (aUpdated == null && bUpdated != null) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

async function searchStorage(
  client: SupabaseClient,
  query: string,
  limit: number,
  offset: number,
): Promise<StorageSearchResult | StorageSearchFailure> {
  const bucket = process.env.SEARCH_STORAGE_BUCKET || DEFAULT_BUCKET;
  const root = normalizeStorageRoot(process.env.SEARCH_STORAGE_ROOT ?? DEFAULT_ROOT);
  const storage = client.storage.from(bucket);
  const queue: string[] = [root];
  const collected: StorageFileEntry[] = [];
  const errors: StorageListError[] = [];
  let scannedDirs = 0;
  let scannedFiles = 0;
  const deadline = Date.now() + SUPABASE_TIMEOUT_MS;

  while (queue.length) {
    if (Date.now() > deadline) {
      return 'timeout';
    }
    const prefix = queue.shift() ?? '';
    let pageOffset = 0;
    let hasMore = true;

    while (hasMore) {
      if (Date.now() > deadline) {
        return 'timeout';
      }

      const { data, error } = await storage.list(prefix, {
        limit: 1000,
        offset: pageOffset,
        sortBy: { column: 'updated_at', order: 'desc' },
      });

      if (error) {
        errors.push({ prefix, message: error.message || String(error) });
        break;
      }

      const entries = Array.isArray(data) ? data : [];
      if (!entries.length) {
        break;
      }

      for (const entry of entries) {
        const isFolder = !entry.metadata;
        if (isFolder) {
          scannedDirs += 1;
          queue.push(buildChildPrefix(prefix, entry.name));
          continue;
        }
        scannedFiles += 1;
        collected.push({
          name: entry.name,
          path: buildFilePath(prefix, entry.name),
          updated_at: entry.updated_at,
          metadata: entry.metadata as StorageFileEntry['metadata'],
        });
      }

      pageOffset += entries.length;
      hasMore = entries.length >= 1000;
    }
  }

  if (!collected.length && errors.length) {
    return 'storage_list_failed';
  }

  const filtered = filterStorageFiles(collected, query);
  const sorted = sortStorageFiles(filtered);
  const total = sorted.length;
  const sliced = sorted.slice(offset, offset + limit);
  const items = sliced.map((file) => {
    const { data: publicData } = storage.getPublicUrl(file.path);
    return {
      name: file.name,
      path: file.path,
      size: file.metadata?.size ?? null,
      updatedAt: file.updated_at ?? null,
      url: publicData?.publicUrl ?? null,
    };
  });

  return { items, total, scannedDirs, scannedFiles, errors };
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
  const debug = parseDebug(req.query?.debug);

  const supabaseConfigured = hasSupabaseConfig();

  let client: SupabaseClient | null = null;
  if (supabaseConfigured) {
    try {
      client = getSupabaseClient();
    } catch (err) {
      logApiError('prints-search', { diagId, step: 'init_client', error: err });
      client = null;
    }
  }

  if (client) {
    try {
      const { items, total } = await searchPrints(client, rawQuery, limit, offset);
      if (total > 0) {
        sendJsonResponse(req, res, 200, {
          ok: true,
          items,
          total,
          limit,
          offset,
          diagId,
          mode: 'db',
        });
        return;
      }
    } catch (err) {
      if (isAbortError(err)) {
        logApiError('prints-search', { diagId, step: 'timeout', error: err });
        sendJsonResponse(req, res, 200, { ok: false, error: 'timeout', diagId });
        return;
      }

      const code = (err as Error & { code?: string })?.code;
      const errorCode = code === 'SUPABASE_DB_ERROR' ? 'db_error' : 'search_failed';
      logApiError('prints-search', { diagId, step: errorCode, error: err });
      // fall through to storage fallback below
      client = null;
    }
  }

  if (!client) {
    if (!supabaseConfigured) {
      logApiError('prints-search', { diagId, step: 'missing_supabase_config' });
    }
    if (supabaseConfigured && !client) {
      try {
        client = getSupabaseClient();
      } catch (err) {
        logApiError('prints-search', { diagId, step: 'init_client_fallback', error: err });
        sendJsonResponse(req, res, 200, { ok: false, error: 'storage_list_failed', diagId });
        return;
      }
    }
  }

  if (!client) {
    sendJsonResponse(req, res, 200, { ok: false, error: 'storage_list_failed', diagId });
    return;
  }

  const storageResult = await searchStorage(client, rawQuery, limit, offset);
  if (storageResult === 'timeout') {
    logApiError('prints-search', { diagId, step: 'storage_timeout' });
    sendJsonResponse(req, res, 200, { ok: false, error: 'timeout', diagId });
    return;
  }
  if (storageResult === 'storage_list_failed') {
    logApiError('prints-search', { diagId, step: 'storage_list_failed' });
    sendJsonResponse(req, res, 200, { ok: false, error: 'storage_list_failed', diagId });
    return;
  }

  const { items, total, scannedDirs, scannedFiles, errors } = storageResult;
  const bucket = process.env.SEARCH_STORAGE_BUCKET || DEFAULT_BUCKET;
  const root = normalizeStorageRoot(process.env.SEARCH_STORAGE_ROOT ?? DEFAULT_ROOT);
  const payload: Record<string, unknown> = {
    ok: true,
    items,
    total,
    limit,
    offset,
    diagId,
    mode: 'storage',
  };

  if (debug) {
    payload.scannedDirs = scannedDirs;
    payload.scannedFiles = scannedFiles;
    payload.bucket = bucket;
    payload.root = root;
    if (errors.length) {
      payload.errors = errors;
    }
  }

  sendJsonResponse(req, res, 200, payload);
}
