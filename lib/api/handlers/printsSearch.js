import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { verifyPrintsGate } from '../_lib/printsGate.js';
import logger from '../../_lib/logger.js';

/** Por página de resultados (firmas Storage); el front puede pedir otro limit. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MIN_SEARCH_LEN = 2;
const DEFAULT_BUCKET = 'outputs';
const DEFAULT_PREVIEW_BUCKET = 'preview';
const SIGNED_DOWNLOAD_TTL_SECONDS = 3600;

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

function escapeIlikeForCount(term) {
  return String(term || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/** Vercel / proxies a veces entregan query repetida como array. */
function pickQueryScalar(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseLimit(value) {
  const raw = pickQueryScalar(value);
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const num = Number(raw);
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

function parseCursorParam(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const json = JSON.parse(Buffer.from(raw.trim(), 'base64url').toString('utf8'));
    if (!json || typeof json.t !== 'string' || typeof json.i !== 'string') return null;
    return {
      p_cursor_created_at: json.t,
      p_cursor_id: json.i,
    };
  } catch {
    return null;
  }
}

/** Keyset pagination: (created_at, id) solo ordena y pagina; no filtra por año ni fecha de publicación. */
function encodeNextCursor(row) {
  if (!row?.created_at || !row?.id) return null;
  return Buffer.from(
    JSON.stringify({ t: row.created_at, i: row.id }),
    'utf8',
  ).toString('base64url');
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
  const previewRaw = row.preview_url ?? row.previewUrl;
  const previewCandidate = typeof previewRaw === 'string' ? previewRaw.trim() : '';
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

function normalizeStoragePath(bucket, filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return '';
  let path = filePath.trim().replace(/^\/+/, '');
  const b = (bucket || OUTPUT_BUCKET).trim();
  if (b && path.toLowerCase().startsWith(`${b.toLowerCase()}/`)) {
    path = path.slice(b.length + 1);
  }
  return path.replace(/^\/+/, '');
}

const DEFER_DOWNLOAD_SIGN =
  String(process.env.PRINTS_SEARCH_DEFER_DOWNLOAD_SIGN || '').trim() === '1';

async function resolveDownloadUrl(supabase, row, fileName) {
  if (DEFER_DOWNLOAD_SIGN) return null;
  const bucket = typeof row.bucket === 'string' && row.bucket.trim()
    ? row.bucket.trim()
    : OUTPUT_BUCKET;
  const path = normalizeStoragePath(bucket, row.file_path);
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(
      path,
      SIGNED_DOWNLOAD_TTL_SECONDS,
      { download: fileName || 'archivo.pdf' },
    );
    const url = data?.signedUrl || data?.signedURL;
    if (error || !url) return null;
    return url;
  } catch {
    return null;
  }
}

function mapRowToItem(row, { previewUrl, downloadUrl }) {
  const fileName = row.file_name || resolveFileName(row.file_path);
  const commercialSize = extractCommercialSize(fileName);
  const wDb = row.width_cm != null ? Number(row.width_cm) : null;
  const hDb = row.height_cm != null ? Number(row.height_cm) : null;
  const widthCm = Number.isFinite(wDb) && wDb > 0 ? wDb : commercialSize.widthCm;
  const heightCm = Number.isFinite(hDb) && hDb > 0 ? hDb : commercialSize.heightCm;
  const designName = typeof row.design_name === 'string' ? row.design_name.trim() : '';
  const title = designName || null;

  return {
    id: row.id || row.slug || row.file_path || fileName,
    title,
    name: designName || fileName,
    price: null,
    thumbUrl: null,
    thumb_url: null,
    fileName,
    path: row.file_path || '',
    slug: row.slug,
    widthCm,
    heightCm,
    material: row.material ?? null,
    sizeBytes: row.file_size_bytes ?? null,
    tags: [],
    createdAt: row.created_at,
    previewUrl,
    preview_url: previewUrl,
    downloadUrl,
    url: downloadUrl,
    design_name: row.design_name ?? null,
  };
}

async function runSearchRpc({
  supabase,
  searchQuery,
  limit,
  limitPlusOne,
  cursor,
  diagId,
}) {
  const args = {
    p_q: searchQuery == null || searchQuery === '' ? null : searchQuery,
    p_limit: Math.max(1, Math.min(101, Number(limitPlusOne) || 1)),
    p_cursor_created_at: cursor?.p_cursor_created_at ?? null,
    p_cursor_id: cursor?.p_cursor_id ?? null,
  };

  let rows = [];
  try {
    const { data, error } = await supabase.rpc('search_prints', args);
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
    /* Por si el RPC en Postgres ignora p_limit (versión vieja): recortar en Node. */
    const cap = Math.min(rows.length, limitPlusOne);
    rows = rows.slice(0, cap);
  } catch (err) {
    console.error('[prints_search] rpc failed', {
      diagId,
      message: err?.message || 'rpc_failed',
    });
    logger.error('prints_search_error', {
      diagId,
      type: 'rpc_failed',
      message: err?.message || 'rpc_failed',
    });
    return { ok: false, items: [], hasMore: false, nextCursor: null };
  }

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  /* El RPC ya exige ruta/nombre .pdf; no filtrar de nuevo (evita perder filas por formato de path). */
  const items = await Promise.all(
    pageRows.map(async (row) => {
      const previewUrl = resolvePreviewUrl(row);
      const fileName = row.file_name || resolveFileName(row.file_path);
      const downloadUrl = await resolveDownloadUrl(supabase, row, fileName);
      return mapRowToItem(row, { previewUrl, downloadUrl });
    }),
  );

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeNextCursor(last) : null;

  return { ok: true, items, hasMore, nextCursor };
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
  try {
    limit = parseLimit(pickQueryScalar(query?.limit));
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

  const rawQuery = typeof query?.query === 'string' ? query.query : '';
  const effectiveQuery = rawQuery
    .normalize('NFKC')
    .replace(/[×✕⨉]/g, 'x')
    .replace(/\|/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const recentOnly = !effectiveQuery;

  if (!recentOnly && effectiveQuery.length < MIN_SEARCH_LEN) {
    logger.error('prints_search_error', {
      diagId,
      type: 'query_too_short',
      message: 'Término demasiado corto.',
    });
    return {
      status: 400,
      body: {
        ok: false,
        reason: 'query_too_short',
        message: 'Ingresá al menos 2 caracteres para buscar.',
        diagId,
      },
    };
  }

  const cursor = parseCursorParam(
    typeof query?.cursor === 'string' ? query.cursor : '',
  );

  const includeTotal = query?.includeTotal === '1' || query?.includeTotal === 'true';

  logger.debug('prints_search_request/start', {
    diagId,
    query: rawQuery,
    limit,
    recentOnly,
    hasCursor: Boolean(cursor),
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
  const dbResult = await runSearchRpc({
    supabase,
    searchQuery: recentOnly ? null : effectiveQuery,
    limit,
    limitPlusOne: limit + 1,
    cursor,
    diagId,
  });
  const dbDurationMs = performance.now() - dbStartedAt;

  if (!dbResult.ok) {
    return {
      status: 502,
      body: {
        ok: false,
        reason: 'search_failed',
        message: 'No se pudo consultar la base de datos.',
        diagId,
      },
    };
  }

  let total = null;
  if (includeTotal && !recentOnly && effectiveQuery) {
    try {
      const esc = escapeIlikeForCount(effectiveQuery);
      const pattern = `%${esc}%`;
      const { count, error } = await supabase
        .from('prints')
        .select('*', { count: 'estimated', head: true })
        .ilike('search_document', pattern);
      if (!error && typeof count === 'number') {
        total = count;
      }
    } catch {
      total = null;
    }
  }

  logger.debug('prints_search_request/done', {
    diagId,
    returned: dbResult.items?.length || 0,
    hasMore: dbResult.hasMore,
    dbDurationMs,
    durationMs: performance.now() - startedAt,
  });

  return {
    status: 200,
    body: {
      ok: true,
      mode: recentOnly ? 'recent' : 'search',
      query: rawQuery,
      total,
      limit,
      hasMore: Boolean(dbResult.hasMore),
      nextCursor: dbResult.nextCursor,
      items: dbResult.items || [],
      diagId,
    },
  };
}

export default searchPrintsHandler;
