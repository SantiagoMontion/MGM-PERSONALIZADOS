import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';

const OUTPUT_BUCKET = 'outputs';
const SIGNED_URL_TTL_SECONDS = 600;
const MAX_MONTHS = 12;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function normalizeForSearch(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\.pdf$/gi, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

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

function buildRecentMonths(count) {
  const results = [];
  const now = new Date();
  for (let idx = 0; idx < count; idx += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - idx, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    results.push({ year, month, key: `print/${year}/${month}` });
  }
  return results;
}

function toTimestamp(input) {
  if (!input) return 0;
  const time = Date.parse(input);
  return Number.isFinite(time) ? time : 0;
}

export async function searchOutputFiles({ query } = {}) {
  const diagId = randomUUID();
  const rawQuery = typeof query?.query === 'string' ? query.query.trim() : '';
  if (!rawQuery) {
    return {
      status: 400,
      body: { error: 'missing_query', message: 'Ingresá al menos 2 caracteres para buscar.' },
    };
  }
  if (rawQuery.length < MIN_QUERY_LENGTH) {
    return {
      status: 400,
      body: { error: 'query_too_short', message: 'Ingresá al menos 2 caracteres para buscar.' },
    };
  }

  const normalizedQuery = normalizeForSearch(rawQuery);
  const limit = parseLimit(query?.limit);
  const offset = parseOffset(query?.offset);

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error('outputs_search_env_error', { diagId, message: err?.message || err });
    return {
      status: 500,
      body: { error: 'supabase_credentials_missing', message: 'Faltan credenciales de Supabase.' },
    };
  }

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  console.info('outputs_search_start', { diagId, query: rawQuery, limit, offset });

  const months = buildRecentMonths(MAX_MONTHS);
  const matches = [];

  for (const month of months) {
    const { data, error } = await storage.list(month.key, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) {
      console.error('outputs_search_list_error', {
        diagId,
        prefix: month.key,
        status: error?.status || error?.statusCode || null,
        message: error?.message,
      });
      return {
        status: 502,
        body: { error: 'storage_unavailable', message: 'No se pudo acceder a Supabase Storage.' },
      };
    }
    if (!Array.isArray(data) || !data.length) continue;
    for (const entry of data) {
      if (!entry || typeof entry.name !== 'string') continue;
      if (!entry.name.toLowerCase().endsWith('.pdf')) continue;
      const normalizedName = normalizeForSearch(entry.name);
      const altName = normalizeForSearch(`${month.year}${month.month}-${entry.name}`);
      const combined = `${normalizedName}-${altName}`;
      if (!combined.includes(normalizedQuery) && !entry.name.toLowerCase().includes(rawQuery.toLowerCase())) {
        continue;
      }
      matches.push({
        name: entry.name,
        path: `${month.key}/${entry.name}`,
        createdAt: entry.created_at || entry.updated_at || entry.last_accessed_at || null,
        size: entry.metadata?.size ?? null,
        normalized: normalizedName,
      });
    }
  }

  matches.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));

  const total = matches.length;
  const paginated = matches.slice(offset, offset + limit);

  const items = await Promise.all(
    paginated.map(async (item) => {
      const { data, error } = await storage.createSignedUrl(item.path, SIGNED_URL_TTL_SECONDS, {
        download: item.name,
      });
      if (error) {
        console.error('outputs_search_signed_url_error', {
          diagId,
          path: item.path,
          status: error?.status || error?.statusCode || null,
          message: error?.message,
        });
      }
      return {
        name: item.name,
        size: item.size,
        createdAt: item.createdAt,
        path: item.path,
        downloadUrl: data?.signedUrl || null,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      };
    }),
  );

  console.info('outputs_search_ok', { diagId, query: rawQuery, limit, offset, total, returned: items.length });

  return {
    status: 200,
    body: {
      items,
      pagination: {
        limit,
        offset,
        total,
      },
    },
  };
}

export default searchOutputFiles;
