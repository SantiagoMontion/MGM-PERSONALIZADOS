import { Buffer } from 'node:buffer';

const SHOPIFY_GID_PREFIX = 'gid://';
const SHOPIFY_VARIANT_BASE64_PREFIX = 'Z2lkOi8v';
const BASE64_CHARS_REGEX = /^[A-Za-z0-9+/=]+$/;

function ensureString(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error('Invalid variant ID format');
    }
    return String(value);
  }
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error('Invalid variant ID format');
    }
    return value.toString();
  }
  return String(value ?? '').trim();
}

function extractNumericSegmentFromGid(gid) {
  const cleaned = gid.split('?')[0];
  const segments = cleaned.split('/');
  const last = segments[segments.length - 1] || '';
  if (/^\d+$/.test(last)) {
    return last;
  }
  throw new Error('Invalid variant ID format');
}

export function idVariantGidToNumeric(gidOrId) {
  if (gidOrId == null) {
    throw new Error('Invalid variant ID format');
  }

  const rawInput = ensureString(gidOrId).trim();
  if (!rawInput) {
    throw new Error('Invalid variant ID format');
  }

  if (/^\d+$/.test(rawInput)) {
    return rawInput;
  }

  if (rawInput.startsWith(SHOPIFY_GID_PREFIX)) {
    return extractNumericSegmentFromGid(rawInput);
  }

  if (BASE64_CHARS_REGEX.test(rawInput) && rawInput.startsWith(SHOPIFY_VARIANT_BASE64_PREFIX)) {
    let decoded;
    try {
      decoded = Buffer.from(rawInput, 'base64').toString('utf8');
    } catch (err) {
      throw new Error('Invalid variant ID format');
    }
    return idVariantGidToNumeric(decoded);
  }

  throw new Error('Invalid variant ID format');
}

export default {
  idVariantGidToNumeric,
};
