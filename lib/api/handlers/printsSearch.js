import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';
import { verifyPrintsGate } from '../_lib/printsGate.js';

const OUTPUT_BUCKET = 'outputs';
const DEFAULT_SEARCH_SIGNED_URL_TTL_SECONDS = 900; // 15 minutos
function resolveSearchSignedUrlTtl() {
  const raw = process.env.SIGNED_URL_TTL_SECONDS_SEARCH;
  if (!raw) return DEFAULT_SEARCH_SIGNED_URL_TTL_SECONDS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  try {
    console.warn?.('prints_search_ttl_invalid', { raw });
  } catch (err) {
    // noop
  }
  return DEFAULT_SEARCH_SIGNED_URL_TTL_SECONDS;
}
const SEARCH_SIGNED_URL_TTL_SECONDS = resolveSearchSignedUrlTtl();
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const PRINTS_TABLE = 'prints';

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

function buildPreviewUrl(path) {
  if (!path) return null;
  const normalized = path.startsWith('outputs/') ? path : `outputs/${path}`;
  return `/api/prints/preview?path=${encodeURIComponent(normalized)}`;
}

function isPdfPath(path) {
  if (typeof path !== 'string') return false;
  return path.toLowerCase().endsWith('.pdf');
}

export async function searchPrintsHandler({ query, headers } = {}) {
  const diagId = randomUUID();
  const gate = verifyPrintsGate({ headers, diagId });
  if (!gate.ok) {
    return {
      status: 401,
      body: { ok: false, reason: 'unauthorized' },
    };
  }
  const rawQuery = typeof query?.query === 'string' ? query.query.trim() : '';

  let limit;
  let offset;

  try {
    limit = parseLimit(query?.limit);
    offset = parseOffset(query?.offset);
  } catch (err) {
    console.error('prints_search_error', {
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
      },
    };
  }

  if (!rawQuery) {
    console.error('prints_search_error', {
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
      },
    };
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error('prints_search_error', {
      diagId,
      type: 'supabase_init_failed',
      message: err?.message || err,
    });
    return {
      status: 502,
      body: {
        ok: false,
        reason: 'supabase_init_failed',
        message: 'Faltan credenciales de Supabase.',
      },
    };
  }

  const normalizedQuery = rawQuery.normalize('NFKC');
  const compactQuery = normalizedQuery.replace(/\s+/g, ' ').trim();
  const commaStrippedQuery = compactQuery.replace(/[;,]+/g, ' ').trim();
  const effectiveQuery = commaStrippedQuery || compactQuery;

  if (!effectiveQuery) {
    console.error('prints_search_error', {
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
      },
    };
  }

  const measurement = parseMeasurement(effectiveQuery);
  const pattern = `%${escapeIlikeTerm(effectiveQuery)}%`;

  let builder = supabase
    .from(PRINTS_TABLE)
    .select(
      'id, job_key, bucket, file_path, file_name, slug, width_cm, height_cm, material, bg_color, job_id, file_size_bytes, created_at',
      { count: 'exact' },
    )
    .like('file_name', '%.pdf')
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

  let rows;
  let totalCount;
  try {
    const { data, count, error } = await builder;
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
    totalCount = typeof count === 'number' ? count : rows.length;
  } catch (err) {
    console.error('prints_search_error', {
      diagId,
      type: 'db_query_failed',
      message: err?.message || 'No se pudo consultar la base de datos.',
    });
    return {
      status: 502,
      body: {
        ok: false,
        reason: 'db_query_failed',
        message: 'No se pudo realizar la búsqueda en la base de datos.',
      },
    };
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
          console.error('prints_search_error', {
            diagId,
            type: 'signed_url_error',
            path: row.file_path,
            message: error?.message || 'No se pudo firmar la URL del PDF.',
          });
        }
      } catch (err) {
        console.error('prints_search_error', {
          diagId,
          type: 'signed_url_error',
          path: row.file_path,
          message: err?.message || err,
        });
      }

      const storagePath = row.file_path || '';
      const fullPath = storagePath.startsWith('outputs/') ? storagePath : `outputs/${storagePath}`;

      return {
        id: row.id,
        jobKey: row.job_key,
        bucket: row.bucket || OUTPUT_BUCKET,
        fileName: row.file_name,
        path: fullPath,
        slug: row.slug,
        widthCm: normalizeNumber(row.width_cm),
        heightCm: normalizeNumber(row.height_cm),
        material: row.material,
        bgColor: row.bg_color,
        jobId: row.job_id,
        sizeBytes: normalizeNumber(row.file_size_bytes),
        createdAt: row.created_at,
        previewUrl: buildPreviewUrl(fullPath),
        downloadUrl,
        expiresIn: SEARCH_SIGNED_URL_TTL_SECONDS,
      };
    }),
  )).filter(Boolean);

  console.info('prints_search_request/ok', {
    diagId,
    query: rawQuery,
    limit,
    offset,
    total: totalCount,
    returned: items.length,
  });

  return {
    status: 200,
    body: {
      ok: true,
      query: rawQuery,
      total: totalCount,
      limit,
      offset,
      items,
    },
  };
}

export default searchPrintsHandler;
