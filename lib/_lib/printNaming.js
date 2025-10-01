import { randomUUID } from 'node:crypto';
import { slugifyName } from './slug.js';

const DEFAULT_SLUG = 'diseno';
const DEFAULT_MATERIAL_SEGMENT = 'CUSTOM';
const MAX_ID_LENGTH = 12;
const DURATION_MS = 24 * 60 * 60 * 1000;

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function formatDimensionSegment(value) {
  const num = toNumber(value);
  if (!num || num <= 0) return null;
  const rounded = Math.round(num * 10) / 10;
  let output;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    output = String(Math.round(rounded));
  } else {
    output = rounded.toFixed(1).replace(/\.0+$/, '');
  }
  return output.replace('.', 'p');
}

function sanitizeMaterialSegment(value) {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (raw) {
      const slug = slugifyName(raw);
      if (slug) return slug.toUpperCase();
      return raw
        .normalize('NFD')
        .replace(/[^\p{ASCII}]/gu, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .toUpperCase()
        .replace(/^-+|-+$/g, '')
        || DEFAULT_MATERIAL_SEGMENT;
    }
  }
  return DEFAULT_MATERIAL_SEGMENT;
}

export function sanitizePdfFilename(input) {
  const raw = String(input || '').trim();
  const last = raw.split(/[\\/]/).pop() || '';
  const ensured = last.toLowerCase().endsWith('.pdf') ? last : `${last}.pdf`;
  const sanitized = ensured.replace(/[^a-z0-9._-]+/gi, '-');
  const trimmed = sanitized.replace(/^-+/, '');
  return trimmed || `${DEFAULT_SLUG}.pdf`;
}

function pickIdSegment({ jobId, jobKey, fallbackFilename }) {
  const candidates = [jobId, jobKey];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const slug = slugifyName(candidate);
    if (slug) return slug.slice(0, MAX_ID_LENGTH);
  }
  if (fallbackFilename) {
    const base = sanitizePdfFilename(fallbackFilename).replace(/\.pdf$/i, '');
    const parts = base.split('-');
    const last = parts.pop();
    if (last) {
      const slug = slugifyName(last);
      if (slug) return slug.slice(0, MAX_ID_LENGTH);
    }
  }
  return randomUUID().replace(/[^a-z0-9]+/gi, '').slice(0, MAX_ID_LENGTH) || randomUUID().slice(0, MAX_ID_LENGTH);
}

export function buildPrintFilenameFromMetadata({
  slug,
  widthCm,
  heightCm,
  material,
  jobId,
  jobKey,
  fallbackFilename,
}, { extension = 'pdf' } = {}) {
  const slugSegment = slugifyName(slug) || DEFAULT_SLUG;
  const widthSegment = formatDimensionSegment(widthCm);
  const heightSegment = formatDimensionSegment(heightCm);
  const hasSize = Boolean(widthSegment && heightSegment);
  const materialSegment = sanitizeMaterialSegment(material);
  const idSegment = pickIdSegment({ jobId, jobKey, fallbackFilename });
  const ext = String(extension || 'pdf').replace(/\.+$/, '').toLowerCase() || 'pdf';

  if (hasSize) {
    return `${[slugSegment, `${widthSegment}x${heightSegment}`, materialSegment, idSegment].join('-')}.${ext}`;
  }

  const fallbackBase = slugifyName(fallbackFilename?.replace(/\.[^.]+$/i, '') || '') || slugSegment;
  return `${[fallbackBase, materialSegment.toLowerCase(), idSegment].join('-')}.${ext}`;
}


export function buildPreviewStorageKey({ filename, now = new Date() }) {
  const safeFilename = sanitizePdfFilename(filename).replace(/\.[^.]+$/i, '.jpg');
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `preview/${year}/${month}/${safeFilename}`;
}

export function buildPreviewStorageDetails({
  slug,
  widthCm,
  heightCm,
  material,
  jobId,
  jobKey,
  fallbackFilename,
  now,
}) {
  const filename = buildPrintFilenameFromMetadata({
    slug,
    widthCm,
    heightCm,
    material,
    jobId,
    jobKey,
    fallbackFilename,
  }, { extension: 'jpg' });
  const path = buildPreviewStorageKey({ filename, now });
  return { filename: sanitizePdfFilename(filename).replace(/\.[^.]+$/i, '.jpg'), path };
}

export function buildPrintStorageKey({ filename, now = new Date() }) {
  const safeFilename = sanitizePdfFilename(filename);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `pdf/${year}/${month}/${safeFilename}`;
}

export function buildPrintStorageDetails({
  slug,
  widthCm,
  heightCm,
  material,
  jobId,
  jobKey,
  fallbackFilename,
  now,
}) {
  const filename = buildPrintFilenameFromMetadata({
    slug,
    widthCm,
    heightCm,
    material,
    jobId,
    jobKey,
    fallbackFilename,
  });
  const path = buildPrintStorageKey({ filename, now });
  return { filename: sanitizePdfFilename(filename), path };
}

export function isWithinAllowedWindow(expiresAt, now = Date.now()) {
  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry)) return false;
  if (expiry < now) return false;
  if (expiry - now > DURATION_MS + 60_000) return false;
  return true;
}

export default buildPrintStorageDetails;
