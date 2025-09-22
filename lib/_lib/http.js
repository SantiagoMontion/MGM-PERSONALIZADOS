const DEFAULT_JSON_LIMIT = 512 * 1024; // 512 KiB

function toError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

export async function readRequestBody(req, { limit = DEFAULT_JSON_LIMIT } = {}) {
  if (!req || typeof req !== 'object') {
    throw toError('invalid_request', 'Request unavailable');
  }

  if (req.body && typeof req.body === 'string') {
    return req.body;
  }

  const chunks = [];
  let total = 0;

  return await new Promise((resolve, reject) => {
    req.on('error', (err) => reject(err));
    req.on('data', (chunk) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > limit) {
        req.destroy?.();
        reject(toError('payload_too_large', 'Request entity too large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export async function parseJsonBody(req, { limit = DEFAULT_JSON_LIMIT } = {}) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const raw = await readRequestBody(req, { limit });
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw toError('invalid_json', 'Body must be valid JSON');
  }
}

export function ensureQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url, `http://${host}`);
    req.query = Object.fromEntries(url.searchParams.entries());
    return req.query;
  } catch {
    req.query = {};
    return req.query;
  }
}

export function getClientIp(req) {
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  const real = headers['x-real-ip'] || headers['X-Real-IP'];

  const pick = (value) => {
    if (Array.isArray(value)) return value[0];
    if (typeof value !== 'string') return '';
    return value.split(',')[0].trim();
  };

  const candidate = pick(forwarded) || pick(real);
  if (candidate) return candidate;

  return req.socket?.remoteAddress || 'unknown';
}

export default {
  readRequestBody,
  parseJsonBody,
  ensureQuery,
  getClientIp,
};
