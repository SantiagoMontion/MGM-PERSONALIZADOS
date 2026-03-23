import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { verifyPrintsGate } from '../_lib/printsGate.js';
import logger from '../../_lib/logger.js';

const PRINTS_TABLE = 'prints';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_PREVIEW_BUCKET = 'preview';
const ALLOWED_SORT_COLUMNS = new Set(['created_at', 'file_name']);

const OUTPUT_BUCKET = process.env.SEARCH_STORAGE_BUCKET || DEFAULT_BUCKET;
const PREVIEW_BUCKET = process.env.SEARCH_PREVIEW_BUCKET || DEFAULT_PREVIEW_BUCKET;

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

function quotePostgrestFilterValue(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildLiteralIlikeOrFilter(columns, term) {
  const pattern = quotePostgrestFilterValue(`%${escapeIlikeTerm(term)}%`);
  return columns.map((column) => `${column}.ilike.${pattern}`).join(',');
}

function isPdfPath(path) {
  if (typeof path !== 'string') return false;
  return path.toLowerCase().endsWith('.pdf');
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
  const filePathCandidate = typeof row.file_path === 'string' ? row.file_path.trim() : '';

  if (!previewCandidate) {
    if (!filePathCandidate || !/\.pdf(?:$|[?#])/i.test(filePathCandidate)) return null;

    const normalizedPdfPath = filePathCandidate
      .replace(/^\/+/, '')
      .replace(/^storage\/v1\/object\/public\//i, '')
      .replace(new RegExp(`^${OUTPUT_BUCKET}/`, 'i'), '');

    const storageRelativePdfPath = normalizedPdfPath.replace(/^outputs\//i, '');
    if (!storageRelativePdfPath) return null;

    const fallbackPreviewPath = storageRelativePdfPath
      .replace(/^pdf-/i, 'mockups-')
      .replace(/\.pdf(?:$|[?#])/i, '.png');

    if (!/^mockups-/i.test(fallbackPreviewPath)) return null;
    if (!supabaseUrl) return null;
    return `${supabaseUrl}/storage/v1/object/public/${PREVIEW_BUCKET}/${fallbackPreviewPath}`;
  }

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
  let builder = supabase
    .from(PRINTS_TABLE)
    .select(
      'created_at, file_name, file_path, slug, preview_url',
      { count: 'estimated' },
    )
    .order(sortBy, { ascending: false })
    .range(offset, offset + limit - 1);

  const orFilters = buildLiteralIlikeOrFilter(
    ['file_name', 'slug', 'file_path'],
    effectiveQuery,
  );
  if (orFilters.length) {
    builder = builder.or(orFilters);
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

  const items = rows
    .map((row) => {
      if (!isPdfPath(row.file_path || row.file_name)) {
        return null;
      }
      const previewUrl = resolvePreviewUrl(row);
      const fileName = row.file_name || resolveFileName(row.file_path);
      const commercialSize = extractCommercialSize(fileName);

      return {
        id: row.slug || row.file_path || fileName,
        title: null,
        price: null,
        thumbUrl: null,
        thumb_url: null,
        fileName,
        path: row.file_path || '',
        slug: row.slug,
        widthCm: commercialSize.widthCm,
        heightCm: commercialSize.heightCm,
        material: null,
        sizeBytes: null,
        tags: [],
        createdAt: row.created_at,
        previewUrl,
        downloadUrl: null,
        url: null,
      };
    })
    .filter(Boolean);

  return { ok: true, items, total: totalCount };
}

function hasValidatedPrintsSession(headers = {}) {
  const value = headers['x-prints-gate-validated'] || headers['X-Prints-Gate-Validated'];
  if (Array.isArray(value)) {
    return value.some((entry) => String(entry).trim().toLowerCase() === 'true');
  }
  return String(value || '').trim().toLowerCase() === 'true';
}

export async function searchPrintsHandler({ query, headers } = {}) {
  const diagId = randomUUID();
  const startedAt = performance.now();
  if (!hasValidatedPrintsSession(headers)) {
    const gate = verifyPrintsGate({ headers, diagId });
    if (!gate.ok) {
      return {
        status: 401,
        body: { ok: false, reason: 'unauthorized', diagId },
      };
    }
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

  const effectiveQuery = rawQuery.normalize('NFKC').replace(/\s+/g, ' ').trim();

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

  logger.debug('prints_search_request/merged', {
    diagId,
    query: rawQuery,
    dbTotal: dbResult.total || 0,
    storageTotal: 0,
    totalMerged: dbResult.total || 0,
    returned: dbResult.items?.length || 0,
    sortBy,
    dbDurationMs,
    storageDurationMs: 0,
    durationMs: performance.now() - startedAt,
  });

  return {
    status: 200,
    body: {
      ok: true,
      mode: 'database_only',
      query: rawQuery,
      total: dbResult.total || 0,
      limit,
      offset,
      sortBy,
      items: dbResult.items || [],
      diagId,
    },
  };
}

export default searchPrintsHandler;
