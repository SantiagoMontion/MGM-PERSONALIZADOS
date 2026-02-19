import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
const STORAGE_LIST_PAGE_SIZE = 100;

let cachedSupabaseClient = null;
let cachedClientSignature = '';

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

function hasKnownFileExtension(name) {
  if (typeof name !== 'string') return false;
  return /\.(pdf|png|jpe?g|webp|gif|svg|tif|tiff|avif)$/i.test(name);
}

function isLikelyFolderEntry(entry) {
  const name = typeof entry?.name === 'string' ? entry.name : '';
  if (!name) return false;

  const missingMetadata = entry?.metadata == null;
  const noKnownFileExtension = !hasKnownFileExtension(name);
  const hasAnyExtension = /\.[a-z0-9]{2,10}$/i.test(name);

  // Supabase puede variar cómo serializa directorios según SDK/version.
  // Evitamos depender sólo de `entry.id === null` para detectar carpetas.
  return noKnownFileExtension || (missingMetadata && !hasAnyExtension);
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

async function listStorageTree(storage, prefix, diagId) {
  const files = [];
  const initialFolders = Array.isArray(prefix)
    ? prefix.filter((value) => typeof value === 'string' && value.trim() !== '')
    : [prefix];
  const folders = initialFolders.length ? [...initialFolders] : [''];

  while (folders.length) {
    const currentPrefix = folders.shift();
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await storage.list(currentPrefix, {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });

      if (error) {
        logger.error('prints_search_error', {
          diagId,
          type: 'storage_list_failed',
          prefix: currentPrefix,
          message: error?.message || 'No se pudo listar el bucket.',
        });
        return null;
      }

      const entries = Array.isArray(data) ? data : [];
      for (const entry of entries) {
        if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
        const entryPath = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;

        if (isLikelyFolderEntry(entry) && !isPdfPath(entry.name)) {
          folders.push(entryPath);
          continue;
        }

        if (isPdfPath(entryPath)) {
          files.push({
            filePath: entryPath,
            fileName: entry.name,
            createdAt: entry.created_at || entry.updated_at || null,
            sizeBytes: entry.metadata?.size ?? null,
          });
        }
      }

      hasMore = entries.length === STORAGE_LIST_PAGE_SIZE;
      offset += entries.length;
    }
  }

  return files;
}

function buildRecentPdfPrefixes(monthCount = 12, now = new Date()) {
  const count = Number.isFinite(monthCount) && monthCount > 0 ? Math.floor(monthCount) : 12;
  const prefixes = [];
  const dedup = new Set();

  for (let i = 0; i < count; i += 1) {
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const candidates = [`pdf-${year}-${month}`, `pdf/${year}/${month}`];

    for (const candidate of candidates) {
      if (dedup.has(candidate)) continue;
      dedup.add(candidate);
      prefixes.push(candidate);
    }
  }

  return prefixes;
}

async function searchStorageFallback({
  supabase,
  effectiveQuery,
  limit,
  offset,
  sortBy,
  diagId,
}) {
  const normalizedQuery = effectiveQuery.toLowerCase();
  const storage = supabase.storage.from(OUTPUT_BUCKET);
  const fallbackPrefixes = buildRecentPdfPrefixes(12);
  const allFiles = await listStorageTree(storage, fallbackPrefixes, diagId);
  if (!allFiles) {
    return { ok: false, items: [], total: 0 };
  }

  const matches = allFiles.filter((entry) => {
    const fileName = String(entry.fileName || '').toLowerCase();
    const filePath = String(entry.filePath || '').toLowerCase();
    return fileName.includes(normalizedQuery) || filePath.includes(normalizedQuery);
  });

  const sorted = [...matches].sort((a, b) => {
    if (sortBy === 'file_name') {
      return String(a.fileName).localeCompare(String(b.fileName));
    }
    const aTime = Date.parse(a.createdAt || '') || 0;
    const bTime = Date.parse(b.createdAt || '') || 0;
    return bTime - aTime;
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
        material: null,
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
    total: matches.length,
  };
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

  const dbStartedAt = performance.now();
  const dbResult = await searchDatabase({
    supabase,
    effectiveQuery,
    limit,
    offset,
    sortBy,
    diagId,
  });
  const dbDurationMs = performance.now() - dbStartedAt;

  if (dbResult.ok && Array.isArray(dbResult.items) && dbResult.items.length > 0) {
    const durationMs = performance.now() - startedAt;
    logger.debug('prints_search_request/db_hit', {
      diagId,
      query: rawQuery,
      total: dbResult.total,
      returned: dbResult.items.length,
      sortBy,
      dbDurationMs,
      durationMs,
    });
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'database',
        query: rawQuery,
        total: dbResult.total,
        limit,
        offset,
        sortBy,
        items: dbResult.items,
        diagId,
      },
    };
  }

  const durationMs = performance.now() - startedAt;
  logger.debug('prints_search_request/db_empty', {
    diagId,
    query: rawQuery,
    sortBy,
    dbDurationMs,
    durationMs,
  });

  const storageStartedAt = performance.now();
  const storageResult = await searchStorageFallback({
    supabase,
    effectiveQuery,
    limit,
    offset,
    sortBy,
    diagId,
  });
  const storageDurationMs = performance.now() - storageStartedAt;

  if (storageResult.ok && Array.isArray(storageResult.items) && storageResult.items.length > 0) {
    logger.debug('prints_search_request/storage_hit', {
      diagId,
      query: rawQuery,
      total: storageResult.total,
      returned: storageResult.items.length,
      sortBy,
      dbDurationMs,
      storageDurationMs,
      durationMs: performance.now() - startedAt,
    });
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'storage_fallback',
        query: rawQuery,
        total: storageResult.total,
        limit,
        offset,
        sortBy,
        items: storageResult.items,
        diagId,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      mode: 'storage_fallback',
      query: rawQuery,
      total: 0,
      limit,
      offset,
      sortBy,
      items: [],
      diagId,
    },
  };
}

export default searchPrintsHandler;
