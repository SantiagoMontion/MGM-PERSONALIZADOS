import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { posix as pathPosix } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { verifyPrintsGate } from '../_lib/printsGate.js';
import logger from '../../_lib/logger.js';

const PRINTS_TABLE = 'prints';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const DEFAULT_SEARCH_SIGNED_URL_TTL_SECONDS = 900; // 15 minutos
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_PREVIEW_BUCKET = 'preview';
const ALLOWED_SORT_COLUMNS = new Set(['created_at', 'file_name']);

const OUTPUT_BUCKET = process.env.SEARCH_STORAGE_BUCKET || DEFAULT_BUCKET;
const PREVIEW_BUCKET = process.env.SEARCH_PREVIEW_BUCKET || DEFAULT_PREVIEW_BUCKET;
const STORAGE_LIST_PAGE_SIZE = 1000;

let cachedSupabaseClient = null;
let cachedClientSignature = '';

function sanitizeRoot(value) {
  if (!value) return '';
  return value.replace(/^\/+|\/+$/g, '');
}

const STORAGE_ROOT = sanitizeRoot(process.env.SEARCH_STORAGE_ROOT || '');

function getSupabaseCredentials() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
  if (!url || !key) {
    return null;
  }
  return { url, key };
}

function getSupabaseClient() {
  const credentials = getSupabaseCredentials();
  if (!credentials) {
    return null;
  }
  const signature = `${credentials.url}::${credentials.key}`;
  if (!cachedSupabaseClient || cachedClientSignature !== signature) {
    cachedSupabaseClient = createClient(credentials.url, credentials.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cachedClientSignature = signature;
  }
  return cachedSupabaseClient;
}

function resolveSearchSignedUrlTtl() {
  const raw = process.env.SIGNED_URL_TTL_SECONDS_SEARCH;
  if (!raw) return DEFAULT_SEARCH_SIGNED_URL_TTL_SECONDS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  try {
    logger.warn('prints_search_ttl_invalid', { raw });
  } catch (err) {
    // noop
  }
  return DEFAULT_SEARCH_SIGNED_URL_TTL_SECONDS;
}

const SEARCH_SIGNED_URL_TTL_SECONDS = resolveSearchSignedUrlTtl();

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new Error('El parámetro "limit" debe ser un entero.');
  }
  if (num < 1) {
    throw new Error('El parámetro "limit" debe ser mayor o igual a 1.');
  }
  if (num > MAX_LIMIT) {
    throw new Error(`El parámetro "limit" no puede superar ${MAX_LIMIT}.`);
  }
  return num;
}

function parseOffset(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new Error('El parámetro "offset" debe ser un entero.');
  }
  if (num < 0) {
    throw new Error('El parámetro "offset" no puede ser negativo.');
  }
  return num;
}

function parseSortColumn(query = {}) {
  const raw = query?.sortBy ?? query?.sort ?? query?.orderBy;
  if (typeof raw !== 'string') return 'created_at';
  const normalized = raw.trim().toLowerCase();
  return ALLOWED_SORT_COLUMNS.has(normalized) ? normalized : 'created_at';
}

function escapeIlikeTerm(term) {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function isPdfPath(path) {
  if (typeof path !== 'string') return false;
  return path.toLowerCase().endsWith('.pdf');
}

function normalizeSearchTerm(value) {
  if (!value) return '';
  let normalized = String(value);
  try {
    normalized = normalized.normalize('NFD');
  } catch (err) {
    // noop
  }
  normalized = normalized.replace(/\p{Diacritic}/gu, '');
  return normalized.toLowerCase();
}

function toComparableTime(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Number(new Date(value).getTime());
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function hasKnownFileExtension(name) {
  if (typeof name !== 'string') return false;
  return /\.(pdf|png|jpe?g|webp|gif|svg|tif|tiff|avif)$/i.test(name);
}

function isStorageFolder(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const name = typeof entry?.name === 'string' ? entry.name : '';
  if (!name) return false;

  if (entry.id === null || entry.id === undefined) {
    if (entry.updated_at || entry.last_modified || entry.created_at) {
      return false;
    }
    if (entry.metadata && typeof entry.metadata === 'object' && 'size' in entry.metadata) {
      return false;
    }
    return !hasKnownFileExtension(name);
  }

  if (entry.metadata && typeof entry.metadata === 'object' && 'size' in entry.metadata) {
    return false;
  }
  if (entry.updated_at || entry.last_modified || entry.created_at) {
    return false;
  }
  return !hasKnownFileExtension(name);
}

function extractCommercialSize(fileName) {
  if (typeof fileName !== 'string') return { widthCm: null, heightCm: null };
  const match = fileName.match(/-(\d+)x(\d+)-/i);
  if (!match) return { widthCm: null, heightCm: null };
  return {
    widthCm: Number(match[1]) || null,
    heightCm: Number(match[2]) || null,
  };
}

function resolveFileName(filePath) {
  if (typeof filePath !== 'string' || !filePath) return '';
  const segments = filePath.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function resolvePreviewUrl(row) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const previewCandidate = typeof row.preview_url === 'string' ? row.preview_url.trim() : '';
  if (!previewCandidate) return null;

  if (/^https?:\/\//i.test(previewCandidate)) {
    return previewCandidate;
  }

  if (!supabaseUrl) return null;

  const normalizedKey = previewCandidate
    .replace(/^\/+/g, '')
    .replace(/^storage\/v1\/object\/public\//i, '')
    .replace(/^preview\//i, `${PREVIEW_BUCKET}/`)
    .replace(/^outputs\//i, `${PREVIEW_BUCKET}/`);

  if (!normalizedKey) return null;
  if (!new RegExp(`^${PREVIEW_BUCKET}/`, 'i').test(normalizedKey)) {
    return `${supabaseUrl}/storage/v1/object/public/${PREVIEW_BUCKET}/${normalizedKey}`;
  }

  return `${supabaseUrl}/storage/v1/object/public/${normalizedKey}`;
}

async function searchDatabase({
  supabase,
  effectiveQuery,
  limit,
  offset,
  sortBy,
  diagId,
}) {
  const pattern = `%${escapeIlikeTerm(effectiveQuery)}%`;

  let builder = supabase
    .from(PRINTS_TABLE)
    .select(
      'id, created_at, file_name, file_path, slug, preview_url, width_cm, height_cm, material, file_size_bytes',
      { count: 'estimated' },
    )
    .or('file_name.ilike.%.pdf,file_path.ilike.%.pdf')
    .order(sortBy, { ascending: false })
    .range(offset, offset + limit - 1);

  const orFilters = [
    `file_name.ilike.${pattern}`,
    `slug.ilike.${pattern}`,
    `file_path.ilike.${pattern}`,
  ];
  if (orFilters.length) {
    builder = builder.or(orFilters.join(','));
  }

  let rows = [];
  let totalCount = 0;
  try {
    const { data, count, error } = await builder;
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
    totalCount = typeof count === 'number' ? count : rows.length;
  } catch (err) {
    console.error('[prints_search] database query failed', {
      diagId,
      message: err?.message || 'No se pudo consultar la base de datos.',
    });
    logger.error('prints_search_error', {
      diagId,
      type: 'db_query_failed',
      message: err?.message || 'No se pudo consultar la base de datos.',
    });
    return { ok: true, items: [], total: 0 };
  }

  if (!rows.length) {
    return { ok: true, items: [], total: totalCount };
  }

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  const items = (await Promise.all(
    rows.map(async (row) => {
      if (!isPdfPath(row.file_path || row.file_name)) {
        return null;
      }
      let downloadUrl = null;
      try {
        const { data, error } = await storage.createSignedUrl(
          row.file_path,
          SEARCH_SIGNED_URL_TTL_SECONDS,
          { download: row.file_name || undefined },
        );
        if (!error) {
          downloadUrl = data?.signedUrl || null;
        } else {
          logger.error('prints_search_error', {
            diagId,
            type: 'signed_url_error',
            path: row.file_path,
            message: error?.message || 'No se pudo firmar la URL del PDF.',
          });
        }
      } catch (err) {
        logger.error('prints_search_error', {
          diagId,
          type: 'signed_url_error',
          path: row.file_path,
          message: err?.message || err,
        });
      }

      const previewUrl = resolvePreviewUrl(row);
      const fileName = row.file_name || resolveFileName(row.file_path);
      const commercialSize = extractCommercialSize(fileName);

      return {
        id: row.id,
        title: null,
        price: null,
        thumbUrl: null,
        thumb_url: null,
        fileName,
        path: row.file_path || '',
        slug: row.slug,
        widthCm: commercialSize.widthCm,
        heightCm: commercialSize.heightCm,
        material: row.material || null,
        sizeBytes: row.file_size_bytes || null,
        tags: [],
        createdAt: row.created_at,
        previewUrl,
        downloadUrl,
        url: downloadUrl,
        expiresIn: SEARCH_SIGNED_URL_TTL_SECONDS,
      };
    }),
  )).filter(Boolean);

  return { ok: true, items, total: totalCount };
}

async function searchStorageFallback({
  supabase,
  effectiveQuery,
  limit,
  offset,
  sortBy,
  diagId,
}) {
  const normalizedQuery = normalizeSearchTerm(effectiveQuery);
  const storage = supabase.storage.from(OUTPUT_BUCKET);

  const queue = [STORAGE_ROOT];
  const visited = new Set();
  const matches = [];
  let foldersScanned = 0;

  while (queue.length) {
    const current = queue.shift() ?? '';
    const sanitizedCurrent = sanitizeRoot(current);
    if (visited.has(sanitizedCurrent)) continue;
    visited.add(sanitizedCurrent);
    foldersScanned += 1;

    let offsetPage = 0;
    let keepListing = true;
    while (keepListing) {
      let response;
      try {
        response = await storage.list(sanitizedCurrent || '', {
          limit: STORAGE_LIST_PAGE_SIZE,
          offset: offsetPage,
          sortBy: { column: 'name', order: 'desc' },
        });
      } catch (err) {
        logger.error('prints_search_error', {
          diagId,
          type: 'storage_list_failed',
          path: sanitizedCurrent,
          message: err?.message || err,
        });
        break;
      }

      if (response?.error) {
        logger.error('prints_search_error', {
          diagId,
          type: 'storage_list_failed',
          path: sanitizedCurrent,
          message: response.error?.message || 'No se pudo listar el bucket.',
        });
        break;
      }

      const entries = Array.isArray(response?.data) ? response.data : [];
      for (const entry of entries) {
        if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
        const entryPath = sanitizedCurrent
          ? pathPosix.join(sanitizedCurrent, entry.name)
          : entry.name;

        if (isStorageFolder(entry)) {
          queue.push(entryPath);
          continue;
        }

        if (!isPdfPath(entryPath)) continue;
        const normalizedName = normalizeSearchTerm(entry.name);
        const normalizedPath = normalizeSearchTerm(entryPath);
        if (!normalizedName.includes(normalizedQuery) && !normalizedPath.includes(normalizedQuery)) {
          continue;
        }

        matches.push({
          filePath: entryPath,
          fileName: entry.name,
          createdAt: entry.updated_at || entry.created_at || entry.last_modified || null,
          material: entry.metadata?.material || null,
          sizeBytes: entry.metadata?.size ?? entry.size ?? null,
        });
      }

      keepListing = entries.length === STORAGE_LIST_PAGE_SIZE;
      offsetPage += entries.length;
    }
  }

  logger.debug('prints_search_storage_scan', {
    diagId,
    foldersScanned,
    matched: matches.length,
  });

  const sorted = matches.sort((a, b) => {
    const aTime = toComparableTime(a.createdAt);
    const bTime = toComparableTime(b.createdAt);
    if (aTime !== bTime) return bTime - aTime;
    return String(a.fileName).localeCompare(String(b.fileName));
  });

  const paginated = sorted.slice(offset, offset + limit);
  const items = (await Promise.all(
    paginated.map(async (entry) => {
      let downloadUrl = null;
      try {
        const { data, error } = await storage.createSignedUrl(
          entry.filePath,
          SEARCH_SIGNED_URL_TTL_SECONDS,
          { download: entry.fileName },
        );
        if (!error) {
          downloadUrl = data?.signedUrl || null;
        }
      } catch (err) {
        logger.error('prints_search_error', {
          diagId,
          type: 'signed_url_error',
          path: entry.filePath,
          message: err?.message || err,
        });
      }

      const commercialSize = extractCommercialSize(entry.fileName);
      return {
        id: entry.filePath,
        title: null,
        price: null,
        thumbUrl: null,
        thumb_url: null,
        fileName: entry.fileName,
        path: entry.filePath,
        slug: null,
        widthCm: commercialSize.widthCm,
        heightCm: commercialSize.heightCm,
        material: entry.material,
        sizeBytes: entry.sizeBytes,
        tags: [],
        createdAt: entry.createdAt,
        previewUrl: null,
        downloadUrl,
        url: downloadUrl,
        expiresIn: SEARCH_SIGNED_URL_TTL_SECONDS,
      };
    }),
  )).filter(Boolean);

  return {
    ok: true,
    items,
    total: sorted.length,
  };
}

function mergeAndSortResults(dbItems = [], storageItems = [], sortBy = 'created_at') {
  const dedup = new Map();
  const register = (item) => {
    if (!item) return;
    const normalizedPath = String(item.path || '').replace(/^outputs\//i, '');
    const key = normalizedPath || String(item.id || '');
    if (!key) return;
    if (!dedup.has(key)) {
      dedup.set(key, { ...item, path: normalizedPath || item.path || '' });
      return;
    }
    const existing = dedup.get(key);
    dedup.set(key, {
      ...existing,
      ...item,
      path: normalizedPath || existing.path,
      previewUrl: existing.previewUrl || item.previewUrl || null,
      material: existing.material || item.material || null,
      sizeBytes: existing.sizeBytes ?? item.sizeBytes ?? null,
      widthCm: existing.widthCm || item.widthCm || null,
      heightCm: existing.heightCm || item.heightCm || null,
      createdAt: existing.createdAt || item.createdAt || null,
    });
  };

  dbItems.forEach(register);
  storageItems.forEach(register);

  const merged = [...dedup.values()];
  merged.sort((a, b) => {
    if (sortBy === 'file_name') {
      return String(a.fileName || '').localeCompare(String(b.fileName || ''));
    }
    const diff = toComparableTime(b.createdAt) - toComparableTime(a.createdAt);
    if (diff !== 0) return diff;
    return String(a.fileName || '').localeCompare(String(b.fileName || ''));
  });
  return merged;
}

export async function searchPrintsHandler({ query, headers } = {}) {
  const diagId = randomUUID();
  const startedAt = performance.now();
  const gate = verifyPrintsGate({ headers, diagId });
  if (!gate.ok) {
    return {
      status: 401,
      body: { ok: false, reason: 'unauthorized', diagId },
    };
  }

  let limit;
  let offset;
  const sortBy = parseSortColumn(query);
  try {
    limit = parseLimit(query?.limit);
    offset = parseOffset(query?.offset);
  } catch (err) {
    logger.error('prints_search_error', {
      diagId,
      type: 'bad_request',
      message: err?.message || 'Parámetros inválidos.',
    });
    return {
      status: 400,
      body: {
        ok: false,
        reason: 'bad_request',
        message: err?.message || 'Parámetros inválidos.',
        diagId,
      },
    };
  }

  const rawQuery = typeof query?.query === 'string' ? query.query.trim() : '';
  if (!rawQuery) {
    logger.error('prints_search_error', {
      diagId,
      type: 'missing_query',
      message: 'Se requiere un término de búsqueda.',
    });
    return {
      status: 400,
      body: {
        ok: false,
        reason: 'missing_query',
        message: 'Ingresá un término para buscar.',
        diagId,
      },
    };
  }

  const compactQuery = rawQuery.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const commaStrippedQuery = compactQuery.replace(/[;,]+/g, ' ').trim();
  const effectiveQuery = commaStrippedQuery || compactQuery;

  if (!effectiveQuery) {
    logger.error('prints_search_error', {
      diagId,
      type: 'missing_query',
      message: 'Se requiere un término de búsqueda válido.',
    });
    return {
      status: 400,
      body: {
        ok: false,
        reason: 'missing_query',
        message: 'Ingresá un término para buscar.',
        diagId,
      },
    };
  }

  logger.debug('prints_search_request/start', {
    diagId,
    query: rawQuery,
    limit,
    offset,
    sortBy,
  });

  const supabase = getSupabaseClient();
  if (!supabase) {
    logger.error('prints_search_error', {
      diagId,
      type: 'supabase_unavailable',
      message: 'Faltan credenciales de Supabase.',
    });
    return {
      status: 502,
      body: {
        ok: false,
        reason: 'supabase_unavailable',
        message: 'Faltan credenciales de Supabase.',
        diagId,
      },
    };
  }

  const fetchWindow = Math.min(Math.max((offset + limit) * 3, 600), 2000);

  const dbStartedAt = performance.now();
  const dbResult = await searchDatabase({
    supabase,
    effectiveQuery,
    limit: fetchWindow,
    offset: 0,
    sortBy,
    diagId,
  });
  const dbDurationMs = performance.now() - dbStartedAt;

  const storageStartedAt = performance.now();
  const storageResult = await searchStorageFallback({
    supabase,
    effectiveQuery,
    limit: fetchWindow,
    offset: 0,
    sortBy,
    diagId,
  });
  const storageDurationMs = performance.now() - storageStartedAt;

  const mergedItems = mergeAndSortResults(
    dbResult.ok ? dbResult.items : [],
    storageResult.ok ? storageResult.items : [],
    sortBy,
  );
  const totalMerged = mergedItems.length;
  const pagedItems = mergedItems.slice(offset, offset + limit);

  logger.debug('prints_search_request/merged', {
    diagId,
    query: rawQuery,
    dbTotal: dbResult.total || 0,
    storageTotal: storageResult.total || 0,
    totalMerged,
    returned: pagedItems.length,
    sortBy,
    dbDurationMs,
    storageDurationMs,
    durationMs: performance.now() - startedAt,
  });

  return {
    status: 200,
    body: {
      ok: true,
      mode: 'hybrid',
      query: rawQuery,
      total: totalMerged,
      limit,
      offset,
      sortBy,
      items: pagedItems,
      diagId,
    },
  };
}

export default searchPrintsHandler;
