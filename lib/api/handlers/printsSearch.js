import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';

const OUTPUT_BUCKET = 'outputs';
const SIGNED_URL_TTL_SECONDS = 86_400;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_MONTHS = 12;

function parseLimit(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(num), 1), MAX_LIMIT);
}

function parseOffset(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}

function normalizeName(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function monthPrefixes(count) {
  const now = new Date();
  const entries = [];
  for (let idx = 0; idx < count; idx += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - idx, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    entries.push({ year, month, key: `print/${year}/${month}` });
  }
  return entries;
}

function toTimestamp(value) {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

export async function searchPrintsHandler({ query } = {}) {
  const diagId = randomUUID();
  const rawQuery = typeof query?.query === 'string' ? query.query.trim() : '';

  if (!rawQuery) {
    return {
      status: 400,
      body: { ok: false, diagId, error: 'missing_query', message: 'Ingresá al menos 2 caracteres para buscar.' },
    };
  }

  if (rawQuery.length < MIN_QUERY_LENGTH) {
    return {
      status: 400,
      body: { ok: false, diagId, error: 'query_too_short', message: 'Ingresá al menos 2 caracteres para buscar.' },
    };
  }

  const limit = parseLimit(query?.limit);
  const offset = parseOffset(query?.offset);
  const normalizedQuery = normalizeName(rawQuery.replace(/\.pdf$/i, ''));

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error('search_env_error', { diagId, message: err?.message || err });
    return {
      status: 500,
      body: { ok: false, diagId, error: 'supabase_credentials_missing', message: 'Faltan credenciales de Supabase.' },
    };
  }

  const storage = supabase.storage.from(OUTPUT_BUCKET);

  console.info('search_request', { diagId, query: rawQuery, limit, offset });

  const months = monthPrefixes(MAX_MONTHS);
  const matches = [];

  for (const month of months) {
    const { data, error } = await storage.list(month.key, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) {
      console.error('search_list_error', {
        diagId,
        prefix: month.key,
        status: error?.status || error?.statusCode || null,
        message: error?.message,
      });
      return {
        status: 502,
        body: { ok: false, diagId, error: 'storage_unavailable', message: 'No se pudo acceder a Supabase Storage.' },
      };
    }
    if (!Array.isArray(data) || !data.length) continue;
    for (const entry of data) {
      if (!entry || typeof entry.name !== 'string') continue;
      if (!entry.name.toLowerCase().endsWith('.pdf')) continue;
      const baseName = entry.name.replace(/\.pdf$/i, '');
      const normalizedName = normalizeName(baseName);
      if (!normalizedName.startsWith(normalizedQuery) && !baseName.toLowerCase().startsWith(rawQuery.toLowerCase())) {
        continue;
      }
      matches.push({
        name: entry.name,
        path: `${month.key}/${entry.name}`,
        createdAt: entry.created_at || entry.updated_at || entry.last_accessed_at || null,
        size: entry.metadata?.size ?? null,
      });
    }
  }

  matches.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));

  const total = matches.length;
  const slice = matches.slice(offset, offset + limit);

  const items = await Promise.all(
    slice.map(async (item) => {
      const { data, error } = await storage.createSignedUrl(item.path, SIGNED_URL_TTL_SECONDS, { download: item.name });
      if (error) {
        console.error('search_signed_url_error', {
          diagId,
          path: item.path,
          status: error?.status || error?.statusCode || null,
          message: error?.message,
        });
      }
      return {
        name: item.name,
        path: item.path,
        size: item.size,
        createdAt: item.createdAt,
        downloadUrl: data?.signedUrl || null,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      };
    }),
  );

  console.info('search_result_count', { diagId, query: rawQuery, total, returned: items.length });

  return {
    status: 200,
    body: {
      ok: true,
      diagId,
      items,
      pagination: {
        limit,
        offset,
        total,
      },
    },
  };
}

export default searchPrintsHandler;
