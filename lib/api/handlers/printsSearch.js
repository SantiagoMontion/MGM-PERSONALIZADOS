import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';

const OUTPUT_BUCKET = 'outputs';
const ROOT_PREFIX = 'pdf';
const SIGNED_URL_TTL_SECONDS = 900; // 15 minutes
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_DEPTH = 5;
const LIST_PAGE_SIZE = 1000;
const PREVIEW_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

function normalizePathPrefix(prefix) {
  return String(prefix || '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function normalizeString(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function normalizeQuery(input) {
  const withoutExtension = String(input || '').replace(/\.pdf$/i, '');
  return normalizeString(withoutExtension);
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

function toTimestamp(value) {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function isFolder(entry) {
  return !entry?.id && !entry?.metadata;
}

function getExtension(name) {
  const match = /\.([^.]+)$/.exec(name || '');
  return match ? `.${match[1].toLowerCase()}` : '';
}

async function listAllEntries(storage, prefix) {
  const sanitized = normalizePathPrefix(prefix);
  const results = [];
  let page = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await storage.list(sanitized, {
      limit: LIST_PAGE_SIZE,
      offset: page * LIST_PAGE_SIZE,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      const status = error?.status || error?.statusCode || 0;
      if (status === 404) {
        return results;
      }
      const err = new Error(error?.message || 'No se pudo listar el directorio.');
      err.type = 'storage_list_failed';
      err.detail = error?.message;
      err.status = status;
      err.prefix = sanitized;
      throw err;
    }
    if (!Array.isArray(data) || data.length === 0) {
      break;
    }
    results.push(...data);
    if (data.length < LIST_PAGE_SIZE) {
      break;
    }
    page += 1;
    if (page >= 1000) {
      const err = new Error('Se alcanzó el límite de paginación al listar archivos.');
      err.type = 'storage_pagination_limit';
      err.prefix = sanitized;
      throw err;
    }
  }
  return results;
}

function pickPreviewCandidate(prefix, entry, previewMap) {
  const fullBase = `${normalizePathPrefix(prefix)}/${entry.name.replace(/\.[^.]+$/u, '')}`;
  return previewMap.get(fullBase) || null;
}

function registerPreview(prefix, entry, previewMap) {
  const base = `${normalizePathPrefix(prefix)}/${entry.name.replace(/\.[^.]+$/u, '')}`;
  const extension = getExtension(entry.name);
  const existing = previewMap.get(base);
  if (!existing || (existing.extension !== '.png' && extension === '.png')) {
    previewMap.set(base, {
      path: prefix ? `${normalizePathPrefix(prefix)}/${entry.name}` : entry.name,
      extension,
      createdAt: entry.created_at || entry.updated_at || entry.last_accessed_at || null,
      updatedAt: entry.updated_at || entry.created_at || entry.last_accessed_at || null,
    });
  }
}

async function collectPdfFiles(storage, requestId) {
  const matches = [];
  const queue = [{ prefix: ROOT_PREFIX, depth: 0 }];

  while (queue.length > 0) {
    const { prefix, depth } = queue.shift();
    const entries = await listAllEntries(storage, prefix);
    if (!entries.length) continue;

    const previewMap = new Map();
    const folders = [];
    const sanitizedPrefix = normalizePathPrefix(prefix);

    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
      if (isFolder(entry)) {
        if (depth + 1 <= MAX_DEPTH) {
          const childPrefix = sanitizedPrefix ? `${sanitizedPrefix}/${entry.name}` : entry.name;
          folders.push(childPrefix);
        }
        continue;
      }

      const extension = getExtension(entry.name);
      if (PREVIEW_EXTENSIONS.includes(extension)) {
        registerPreview(sanitizedPrefix, entry, previewMap);
      }
    }

    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
      if (isFolder(entry)) continue;
      const extension = getExtension(entry.name);
      if (extension !== '.pdf') continue;
      const baseName = entry.name.replace(/\.pdf$/i, '');
      const previewCandidate = pickPreviewCandidate(sanitizedPrefix, entry, previewMap);
      const path = sanitizedPrefix ? `${sanitizedPrefix}/${entry.name}` : entry.name;
      matches.push({
        name: entry.name,
        baseName,
        path,
        size: entry.metadata?.size ?? null,
        contentType: entry.metadata?.mimetype || 'application/pdf',
        createdAt: entry.created_at || entry.updated_at || entry.last_accessed_at || null,
        updatedAt: entry.updated_at || entry.created_at || entry.last_accessed_at || null,
        previewPath: previewCandidate?.path || null,
      });
    }

    if (folders.length > 0) {
      for (const folder of folders) {
        queue.push({ prefix: folder, depth: depth + 1 });
      }
    }
  }

  return matches;
}

export async function searchPrintsHandler({ query } = {}) {
  const requestId = randomUUID();
  const rawQuery = typeof query?.query === 'string' ? query.query.trim() : '';

  let limit;
  let offset;

  try {
    limit = parseLimit(query?.limit);
    offset = parseOffset(query?.offset);
  } catch (err) {
    console.error('prints_search_error', {
      requestId,
      type: 'bad_request',
      message: err?.message || 'Parámetros inválidos.',
    });
    return {
      status: 400,
      body: { error: 'bad_request', message: err?.message || 'Parámetros inválidos.' },
    };
  }

  const normalizedQuery = normalizeQuery(rawQuery);
  const rawQueryLower = rawQuery ? rawQuery.toLowerCase() : '';

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error('prints_search_error', {
      requestId,
      type: 'supabase_credentials_missing',
      message: err?.message || err,
    });
    return {
      status: 502,
      body: {
        error: 'supabase_error',
        requestId,
        detail: 'Faltan credenciales de Supabase.',
      },
    };
  }

  console.info('prints_search_request', { requestId, query: rawQuery || null, limit, offset });

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  let files;
  try {
    files = await collectPdfFiles(storage, requestId);
  } catch (err) {
    console.error('prints_search_error', {
      requestId,
      type: err?.type || 'supabase_error',
      message: err?.message || 'No se pudo obtener la lista de archivos.',
      detail: err?.detail || null,
      prefix: err?.prefix || ROOT_PREFIX,
    });
    return {
      status: 502,
      body: {
        error: 'supabase_error',
        requestId,
        detail: err?.message || 'No se pudo obtener la lista de archivos desde Supabase.',
      },
    };
  }

  const hasQuery = normalizedQuery.length > 0;
  const filtered = hasQuery
    ? files.filter((file) => {
        const normalizedName = normalizeString(file.baseName);
        return (
          normalizedName.includes(normalizedQuery) ||
          (rawQueryLower ? file.baseName.toLowerCase().includes(rawQueryLower) : false)
        );
      })
    : files;

  filtered.sort((a, b) => {
    const tsDiff = toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
    if (tsDiff !== 0) return tsDiff;
    return a.name.localeCompare(b.name);
  });

  const total = filtered.length;
  const slice = filtered.slice(offset, offset + limit);

  const items = await Promise.all(
    slice.map(async (item) => {
      let downloadUrl = null;
      let previewImageUrl = null;

      try {
        const signed = await storage.createSignedUrl(item.path, SIGNED_URL_TTL_SECONDS, {
          download: item.name,
        });
        if (signed?.data?.signedUrl) {
          downloadUrl = signed.data.signedUrl;
        } else if (signed?.error) {
          console.error('prints_search_error', {
            requestId,
            type: 'signed_url_error',
            message: signed.error?.message || 'No se pudo firmar la URL del PDF.',
            path: item.path,
          });
        }
      } catch (err) {
        console.error('prints_search_error', {
          requestId,
          type: 'signed_url_error',
          message: err?.message || 'Fallo al firmar la URL del PDF.',
          path: item.path,
        });
      }

      if (item.previewPath) {
        try {
          const previewSigned = await storage.createSignedUrl(item.previewPath, SIGNED_URL_TTL_SECONDS, {
            download: item.previewPath.split('/').pop() || undefined,
          });
          if (previewSigned?.data?.signedUrl) {
            previewImageUrl = previewSigned.data.signedUrl;
          } else if (previewSigned?.error && previewSigned.error?.status !== 404) {
            console.error('prints_search_error', {
              requestId,
              type: 'signed_url_error',
              message: previewSigned.error?.message || 'No se pudo firmar la URL de preview.',
              path: item.previewPath,
            });
          }
        } catch (err) {
          console.error('prints_search_error', {
            requestId,
            type: 'signed_url_error',
            message: err?.message || 'Fallo al firmar la URL de preview.',
            path: item.previewPath,
          });
        }
      }

      return {
        name: item.name,
        path: item.path,
        size: item.size,
        contentType: item.contentType,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        downloadUrl,
        previewImageUrl: previewImageUrl || undefined,
      };
    }),
  );

  console.info('prints_search_results', {
    requestId,
    query: rawQuery || null,
    total,
    returned: items.length,
  });

  return {
    status: 200,
    body: {
      query: rawQuery || null,
      limit,
      offset,
      total,
      items,
    },
  };
}

export default searchPrintsHandler;
