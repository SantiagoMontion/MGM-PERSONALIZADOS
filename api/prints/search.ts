import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDiagId, logApiError } from '../_lib/diag.js';
import { applyLenientCors } from '../_lib/lenientCors.js';
import { extractDims, publicUrlForMockup } from '../../lib/_lib/previewPath.js';
import { slugifyName } from '../../lib/_lib/slug.js';

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
  previewUrl?: string | null;
  preview_url?: string | null;
  mockupPublicUrl?: string | null;
  mockup_public_url?: string | null;
  material?: string | null;
  options?: Record<string, unknown> | null;
  designName?: string | null;
  design_name?: string | null;
  widthCm?: number | null;
  width_cm?: number | null;
  heightCm?: number | null;
  height_cm?: number | null;
  widthMm?: number | null;
  width_mm?: number | null;
  heightMm?: number | null;
  height_mm?: number | null;
  masterWidthMm?: number | null;
  master_width_mm?: number | null;
  masterHeightMm?: number | null;
  master_height_mm?: number | null;
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
  previewUrl: string | null;
};

type StorageListError = { prefix: string; message: string };

type StorageFileEntry = {
  name: string;
  path: string;
  updated_at?: string | null;
  metadata?: { size?: number | null } | null;
};

type SupabaseStorageClient = ReturnType<SupabaseClient['storage']['from']>;

type StorageSearchItem = {
  name: string;
  path: string;
  downloadUrl: string | null;
  previewUrl: string | null;
  sizeBytes: number | null;
  sizeMB: number | null;
  updatedAt: string | null;
  measure: string | null;
  material: string | null;
  widthCm?: number | null;
  heightCm?: number | null;
  previewTried?: string[];
  previewFound?: boolean;
  previewScan?: {
    candidates: { dir: string; rule: string }[];
    matched: string | null;
    dirListed: string[];
  };
};

type StorageSearchResult = {
  items: StorageSearchItem[];
  total: number;
  scannedDirs: number;
  scannedFiles: number;
  errors: StorageListError[];
};

type StorageSearchFailure = 'storage_list_failed' | 'timeout';

type SearchTerms = {
  qRaw: string;
  qBase: string;
  qLoose: string;
  tokens: string[];
};

function normalizeForSearch(str: string): string {
  if (typeof str !== 'string') {
    return '';
  }
  const lower = str.toLowerCase();
  const trimmed = lower.trim();
  if (!trimmed) {
    return '';
  }
  const withoutAccents = trimmed.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const withHyphenSeparators = withoutAccents.replace(/[._\s]+/g, '-');
  const collapsedHyphens = withHyphenSeparators.replace(/-+/g, '-');
  return collapsedHyphens.replace(/^-+|-+$/g, '');
}

function stripSeparators(str: string): string {
  if (typeof str !== 'string' || !str) {
    return '';
  }
  return str.replace(/[-_.\s]+/g, '');
}

function buildSearchTerms(query: string): SearchTerms {
  const qRaw = typeof query === 'string' ? query : '';
  const qBase = normalizeForSearch(qRaw);
  const qLoose = stripSeparators(qBase);
  const tokens = qBase.split('-').filter(Boolean);
  return { qRaw, qBase, qLoose, tokens };
}

const PREVIEW_BUCKET =
  process.env.PREVIEW_STORAGE_BUCKET ||
  process.env.SEARCH_STORAGE_BUCKET ||
  DEFAULT_BUCKET;
let PREVIEW_ROOT = (process.env.PREVIEW_STORAGE_ROOT || 'preview')
  .replace(/^\/+/, '')
  .replace(/\/+$/, '');
const PREVIEW_EXTS = (process.env.PREVIEW_EXTS || 'jpg,jpeg,png')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

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
  const preview =
    row.previewUrl ??
    row.preview_url ??
    row.mockupPublicUrl ??
    row.mockup_public_url ??
    publicUrlForMockup(row) ??
    null;
  return {
    id: (row.id as string | number | null) ?? null,
    title: row.title ?? null,
    slug: row.slug ?? null,
    thumbUrl: thumb,
    tags: row.tags ?? null,
    price: row.price ?? null,
    popularity: typeof row.popularity === 'number' ? row.popularity : null,
    createdAt: created,
    previewUrl: preview,
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
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
  if (!trimmed || trimmed === '/') return '';
  const withoutLeading = trimmed.replace(/^\/+/, '');
  if (!withoutLeading) return '';
  const normalized = withoutLeading.replace(/\/+/g, '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function ensureTrailingSlash(value: string): string {
  if (!value) return '';
  return value.endsWith('/') ? value : `${value}/`;
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

function getFileBaseName(name: string): string {
  if (!name) {
    return '';
  }
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) {
    return name;
  }
  return name.slice(0, dotIndex);
}

function filterStorageFiles(files: StorageFileEntry[], terms: SearchTerms): StorageFileEntry[] {
  const { qRaw, qBase, qLoose, tokens } = terms;
  const qRawLower = qRaw.toLowerCase();
  const hasQuery = Boolean(qRawLower || qBase || qLoose || tokens.length);

  return files.filter((file) => {
    if (!isPdfFile(file.name)) {
      return false;
    }
    if (!hasQuery) {
      return true;
    }

    const baseName = getFileBaseName(file.name);
    const nameRaw = baseName.toLowerCase();
    const nameBase = normalizeForSearch(baseName);
    const nameLoose = stripSeparators(nameBase);

    const matchesRaw = qRawLower ? nameRaw.includes(qRawLower) : false;
    const matchesBase = qBase ? nameBase.includes(qBase) : false;
    const matchesLoose = qLoose ? nameLoose.includes(qLoose) : false;
    const matchesTokens = tokens.length ? tokens.every((token) => nameBase.includes(token)) : false;

    return matchesRaw || matchesBase || matchesLoose || matchesTokens;
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

function getSignedUrlTtl(): number {
  const raw = Number(process.env.SIGNED_URL_TTL);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 3600;
  }
  return Math.floor(raw);
}

async function resolveStorageUrl(
  storage: SupabaseStorageClient,
  path: string,
): Promise<string | null> {
  const { data: publicData } = storage.getPublicUrl(path);
  if (publicData?.publicUrl) {
    return publicData.publicUrl;
  }

  const ttl = getSignedUrlTtl();
  try {
    const { data, error } = await storage.createSignedUrl(path, ttl);
    if (error) {
      return null;
    }
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

function parseMeasureAndMaterial(name: string): {
  measure: string | null;
  material: string | null;
} {
  const match = name.match(/-(\d+x\d+)-([A-Za-z]+)-/i);
  if (!match) {
    return { measure: null, material: null };
  }
  return { measure: match[1] ?? null, material: match[2] ?? null };
}

function computeSizeMb(sizeBytes: number | null): number | null {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes)) {
    return null;
  }
  const megabytes = sizeBytes / 1048576;
  return Number.isFinite(megabytes) ? Number(megabytes.toFixed(2)) : null;
}

function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf('/');
  if (index === -1) {
    return { dir: '', name: path };
  }
  const dir = path.slice(0, index);
  const name = path.slice(index + 1);
  return { dir, name };
}

function joinStoragePath(a: string, b: string): string {
  const left = a.replace(/\/+$/, '');
  const right = b.replace(/^\/+/, '');
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `${left}/${right}`;
}

function normalizeDirPath(dir: string): string {
  if (!dir) return '';
  return dir.replace(/^\/+/, '').replace(/\/+$/, '');
}

function joinPreviewPath(...parts: Array<string | null | undefined>): string {
  const cleaned = parts
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .map((part) => part.replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean);
  return cleaned.join('/');
}

type PreviewScanCandidate = { dir: string; rule: string };

type PreviewScan = {
  candidates: PreviewScanCandidate[];
  matched: string | null;
  dirListed: string[];
};

async function resolvePreview(
  storage: SupabaseStorageClient,
  filePath: string,
): Promise<{ url: string | null; tried: string[]; found: boolean; scan: PreviewScan | null }> {
  const tried: string[] = [];
  if (!/\.pdf$/i.test(filePath)) {
    return { url: null, tried, found: false, scan: null };
  }

  const segments = filePath.split('/').filter(Boolean);
  const pdfIndex = segments.indexOf('pdf');
  let rootPrefix = '';
  let tail = segments.slice();
  if (pdfIndex !== -1) {
    rootPrefix = segments.slice(0, pdfIndex).join('/');
    tail = segments.slice(pdfIndex + 1);
  } else if (segments.length > 1) {
    rootPrefix = segments.slice(0, -1).join('/');
    tail = [segments[segments.length - 1]];
  }

  const file = tail[tail.length - 1] ?? '';
  const base = file.replace(/\.pdf$/i, '');
  const baseLower = base.toLowerCase();
  const hasBase = Boolean(baseLower);
  const yearCandidate = tail[0];
  const year = yearCandidate && /^\d{4}$/.test(yearCandidate) ? yearCandidate : null;
  const monthCandidate = year ? tail[1] : tail[0];
  const month = monthCandidate && /^\d{1,2}$/.test(monthCandidate ?? '') ? monthCandidate : null;

  const scan: PreviewScan = { candidates: [], matched: null, dirListed: [] };
  const dirCache = new Map<string, StorageFileEntry[] | null>();
  const listed = new Set<string>();

  const listDir = async (dir: string): Promise<StorageFileEntry[] | null> => {
    const normalized = normalizeDirPath(dir);
    const display = normalized || '/';
    if (!listed.has(display)) {
      listed.add(display);
      scan.dirListed.push(display);
    }
    if (dirCache.has(normalized)) {
      return dirCache.get(normalized) ?? null;
    }
    try {
      const { data, error } = await storage.list(normalized, { limit: 1000 });
      if (error || !Array.isArray(data)) {
        dirCache.set(normalized, null);
        return null;
      }
      dirCache.set(normalized, data as StorageFileEntry[]);
      return data as StorageFileEntry[];
    } catch {
      dirCache.set(normalized, null);
      return null;
    }
  };

  const baseVariants = (() => {
    if (!hasBase) return [];
    const compact = baseLower.replace(/[\s_]+/g, '-');
    const slug = slugifyName(baseLower);
    const unique = new Set([baseLower, compact, slug].filter(Boolean));
    return Array.from(unique);
  })();

  const findMatch = (entries: StorageFileEntry[] | null): StorageFileEntry | null => {
    if (!entries) {
      return null;
    }
    let prefixMatch: StorageFileEntry | null = null;
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string') {
        continue;
      }
      const size = entry.metadata?.size;
      if (size == null) {
        continue;
      }
      const nameLower = entry.name.toLowerCase();
      const dotIndex = nameLower.lastIndexOf('.');
      const ext = dotIndex === -1 ? '' : nameLower.slice(dotIndex + 1);
      if (!PREVIEW_EXTS.includes(ext)) {
        continue;
      }
      if (!hasBase) {
        return entry;
      }
      if (nameLower === `${baseLower}.${ext}`) {
        return entry;
      }
      if (!baseVariants.length) {
        if (!prefixMatch && nameLower.startsWith(baseLower)) {
          prefixMatch = entry;
        }
        continue;
      }
      const nameBase = nameLower.replace(/\.[^./]+$/, '');
      for (const variant of baseVariants) {
        if (nameBase === variant || nameBase.startsWith(`${variant}-`) || nameBase.startsWith(`${variant} `)) {
          return entry;
        }
      }
      if (!prefixMatch && nameLower.startsWith(baseLower)) {
        prefixMatch = entry;
      }
    }
    return prefixMatch;
  };

  const candidates: Array<{ dir: string; rule: string }> = [];
  const previewRoot = PREVIEW_ROOT;
  const originalDir = normalizeDirPath(splitPath(filePath).dir);
  if (month) {
    candidates.push({
      dir: joinPreviewPath(rootPrefix, previewRoot, month),
      rule: 'month',
    });
  }
  candidates.push({
    dir: joinPreviewPath(rootPrefix, previewRoot),
    rule: 'root',
  });
  if (pdfIndex === -1 && previewRoot && originalDir) {
    candidates.push({
      dir: joinPreviewPath(previewRoot, originalDir),
      rule: 'legacy-dir',
    });
  }
  if (year && month) {
    candidates.push({
      dir: joinPreviewPath(rootPrefix, previewRoot, year, month),
      rule: 'year-month',
    });
  }

  let matchedDir: string | null = null;
  let matchedEntry: StorageFileEntry | null = null;

  const checkCandidate = async (candidate: { dir: string; rule: string }) => {
    const normalizedDir = normalizeDirPath(candidate.dir);
    scan.candidates.push({ dir: normalizedDir || '/', rule: candidate.rule });
    const entries = await listDir(candidate.dir);
    const match = findMatch(entries);
    if (match) {
      matchedDir = normalizedDir;
      matchedEntry = match;
      return true;
    }
    return false;
  };

  for (const candidate of candidates) {
    const found = await checkCandidate(candidate);
    if (found) {
      break;
    }
  }

  const basePreviewDir = joinPreviewPath(rootPrefix, previewRoot);
  const baseDirs: string[] = [basePreviewDir];
  if (pdfIndex === -1) {
    const legacyBaseDir = joinPreviewPath(previewRoot, rootPrefix);
    if (legacyBaseDir && !baseDirs.includes(legacyBaseDir)) {
      baseDirs.push(legacyBaseDir);
    }
  }
  if (!matchedEntry) {
    const visited = new Set<string>();
    const queue: Array<{ dir: string; depth: number }> = [];

    const enqueueChildren = (
      parentDir: string,
      entries: StorageFileEntry[] | null,
      depth: number,
    ) => {
      if (!entries || depth > 2) {
        return;
      }
      for (const entry of entries) {
        if (!entry || entry.metadata) {
          continue;
        }
        const childDir = normalizeDirPath(joinPreviewPath(parentDir, entry.name));
        if (visited.has(childDir)) {
          continue;
        }
        visited.add(childDir);
        queue.push({ dir: childDir, depth });
      }
    };

    for (const dir of baseDirs) {
      const entries = await listDir(dir);
      enqueueChildren(dir, entries, 1);
    }

    while (queue.length && !matchedEntry) {
      const { dir, depth } = queue.shift()!;
      if (depth < 1 || depth > 2) {
        continue;
      }
      const rule = `deep-${depth}`;
      scan.candidates.push({ dir: dir || '/', rule });
      const entries = await listDir(dir);
      const match = findMatch(entries);
      if (match) {
        matchedDir = dir;
        matchedEntry = match;
        break;
      }
      if (depth < 2) {
        enqueueChildren(dir, entries, depth + 1);
      }
    }
  }

  let previewUrl: string | null = null;
  if (matchedEntry) {
    const candidateDir = matchedDir ?? '';
    const candidatePath = candidateDir ? `${candidateDir}/${matchedEntry.name}` : matchedEntry.name;
    tried.push(candidatePath);
    scan.matched = candidatePath;

    const { data: publicResult } = storage.getPublicUrl(candidatePath);
    previewUrl = publicResult?.publicUrl ?? null;
    if (!previewUrl) {
      const ttl = getSignedUrlTtl();
      try {
        const { data: signedResult, error: signedError } = await storage.createSignedUrl(
          candidatePath,
          ttl,
        );
        if (!signedError) {
          previewUrl = signedResult?.signedUrl ?? null;
        }
      } catch {
        previewUrl = null;
      }
    }
  }

  const hasScanData =
    scan.candidates.length > 0 || scan.dirListed.length > 0 || Boolean(scan.matched);
  const scanPayload = hasScanData ? scan : null;

  return { url: previewUrl, tried, found: Boolean(matchedEntry), scan: scanPayload };
}

async function searchStorage(
  client: SupabaseClient,
  query: string,
  limit: number,
  offset: number,
  debug: boolean,
  terms?: SearchTerms,
): Promise<StorageSearchResult | StorageSearchFailure> {
  const bucket = process.env.SEARCH_STORAGE_BUCKET || DEFAULT_BUCKET;
  const root = normalizeStorageRoot(process.env.SEARCH_STORAGE_ROOT ?? DEFAULT_ROOT);
  const storage = client.storage.from(bucket);
  const previewStorage = client.storage.from(PREVIEW_BUCKET);
  const queue: string[] = [root || ''];
  const collected: StorageFileEntry[] = [];
  const errors: StorageListError[] = [];
  let scannedDirs = 0;
  let scannedFiles = 0;
  const deadline = Date.now() + SUPABASE_TIMEOUT_MS;

  while (queue.length) {
    if (Date.now() > deadline) {
      return 'timeout';
    }
    const rawPrefix = queue.shift() ?? '';
    const normalizedPrefix = rawPrefix.replace(/^\/+/, '').replace(/\/+/g, '/');
    const listPrefix = normalizedPrefix;
    const pathPrefix = normalizedPrefix.replace(/\/+$/, '');
    let pageOffset = 0;
    let hasMore = true;

    while (hasMore) {
      if (Date.now() > deadline) {
        return 'timeout';
      }

      const listOptions = {
        limit: 1000,
        offset: pageOffset,
        sortBy: { column: 'updated_at', order: 'desc' as const },
      };
      let currentPrefix = listPrefix;
      let { data, error } = await storage.list(currentPrefix, listOptions);

      if (error && currentPrefix && currentPrefix.endsWith('/')) {
        const retryPrefix = currentPrefix.replace(/\/+$/, '');
        if (retryPrefix !== currentPrefix) {
          const retry = await storage.list(retryPrefix, listOptions);
          if (!retry.error) {
            currentPrefix = retryPrefix;
            data = retry.data;
            error = null;
          }
        }
      }

      if (error) {
        errors.push({ prefix: currentPrefix || pathPrefix, message: error.message || String(error) });
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
          const childPrefix = ensureTrailingSlash(buildChildPrefix(pathPrefix, entry.name));
          queue.push(childPrefix);
          continue;
        }
        scannedFiles += 1;
        collected.push({
          name: entry.name,
          path: buildFilePath(pathPrefix, entry.name),
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

  const searchTerms = terms ?? buildSearchTerms(query);
  const filtered = filterStorageFiles(collected, searchTerms);
  const sorted = sortStorageFiles(filtered);
  const total = sorted.length;
  const sliced = sorted.slice(offset, offset + limit);
  const items = await Promise.all(
    sliced.map(async (file) => {
      const sizeBytes = file.metadata?.size ?? null;
      const [downloadUrl, previewInfo] = await Promise.all([
        resolveStorageUrl(storage, file.path),
        resolvePreview(previewStorage, file.path),
      ]);
      const { measure, material } = parseMeasureAndMaterial(file.name);
      const { wCm, hCm } = extractDims(measure ?? file.name);
      const computedPreview = publicUrlForMockup({
        measure,
        material,
        name: file.name,
        title: file.name,
        created_at: file.updated_at ?? null,
        updated_at: file.updated_at ?? null,
      });
      const item: StorageSearchItem = {
        name: file.name,
        path: file.path,
        downloadUrl,
        previewUrl: previewInfo.url ?? computedPreview,
        sizeBytes,
        sizeMB: computeSizeMb(sizeBytes),
        updatedAt: file.updated_at ?? null,
        measure,
        material,
      };
      if (wCm || hCm) {
        item.widthCm = wCm || null;
        item.heightCm = hCm || null;
      }
      if (debug) {
        item.previewTried = previewInfo.tried;
        item.previewFound = previewInfo.found;
        if (previewInfo.scan) {
          item.previewScan = previewInfo.scan;
        }
      }
      return item;
    }),
  );

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
  const searchTerms = buildSearchTerms(rawQuery);

  if (debug) {
    try {
      console.log('[prints-search]', { diagId, ...searchTerms });
    } catch {}
  }

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

  const storageResult = await searchStorage(client, rawQuery, limit, offset, debug, searchTerms);
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
