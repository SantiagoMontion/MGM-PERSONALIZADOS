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

const OUTPUT_BUCKET = process.env.SEARCH_STORAGE_BUCKET || DEFAULT_BUCKET;

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

function escapeIlikeTerm(term) {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseMeasurement(query) {
  if (!query) return null;
  const match = /([0-9]+(?:[.,][0-9]+)?)\s*[xX]\s*([0-9]+(?:[.,][0-9]+)?)/.exec(query);
  if (!match) return null;
  const width = Number(match[1].replace(',', '.'));
  const height = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function isPdfPath(path) {
  if (typeof path !== 'string') return false;
  return path.toLowerCase().endsWith('.pdf');
}

async function searchDatabase({
  supabase,
  effectiveQuery,
  limit,
  offset,
  measurement,
  diagId,
}) {
  const pattern = `%${escapeIlikeTerm(effectiveQuery)}%`;

  let builder = supabase
    .from(PRINTS_TABLE)
    .select(
      'id, job_key, bucket, file_path, file_name, slug, width_cm, height_cm, material, bg_color, job_id, file_size_bytes, created_at, preview_url',
      { count: 'estimated' },
    )
    .or('file_name.ilike.%.pdf,file_path.ilike.%.pdf')
    .order('created_at', { ascending: false })
    .order('file_name', { ascending: true })
    .range(offset, offset + limit - 1);

  const orFilters = [
    `file_name.ilike.${pattern}`,
    `slug.ilike.${pattern}`,
    `file_path.ilike.${pattern}`,
  ];
  if (measurement) {
    const { width, height } = measurement;
    orFilters.push(`and(width_cm.eq.${width},height_cm.eq.${height})`);
    if (width !== height) {
      orFilters.push(`and(width_cm.eq.${height},height_cm.eq.${width})`);
    }
  }
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
    logger.error('prints_search_error', {
      diagId,
      type: 'db_query_failed',
      message: err?.message || 'No se pudo consultar la base de datos.',
    });
    return { ok: false, reason: 'db_query_failed', message: 'No se pudo realizar la búsqueda en la base de datos.' };
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

      const previewCandidate = typeof row.preview_url === 'string' ? row.preview_url.trim() : '';
      const normalizedPath = (row.file_path || '').startsWith('outputs/')
        ? (row.file_path || '')
        : `outputs/${row.file_path || ''}`;
      const previewUrl = /^https?:\/\//i.test(previewCandidate)
        ? previewCandidate
        : null;

      return {
        id: row.id,
        jobKey: row.job_key,
        bucket: row.bucket || OUTPUT_BUCKET,
        fileName: row.file_name,
        path: normalizedPath,
        slug: row.slug,
        widthCm: normalizeNumber(row.width_cm),
        heightCm: normalizeNumber(row.height_cm),
        material: row.material,
        bgColor: row.bg_color,
        jobId: row.job_id,
        sizeBytes: normalizeNumber(row.file_size_bytes),
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

  const measurement = parseMeasurement(effectiveQuery);
  const dbStartedAt = performance.now();
  const dbResult = await searchDatabase({
    supabase,
    effectiveQuery,
    limit,
    offset,
    measurement,
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
        items: dbResult.items,
        diagId,
      },
    };
  }

  const durationMs = performance.now() - startedAt;
  logger.debug('prints_search_request/db_empty', {
    diagId,
    query: rawQuery,
    dbDurationMs,
    durationMs,
  });

  return {
    status: 200,
    body: {
      ok: true,
      mode: 'database',
      query: rawQuery,
      total: 0,
      limit,
      offset,
      items: [],
      diagId,
    },
  };
}

export default searchPrintsHandler;
