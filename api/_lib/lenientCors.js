const DEFAULT_ALLOW_HEADERS = 'content-type, authorization';
const ALLOW_METHODS = 'GET, POST, OPTIONS';

function resolveOrigin(req) {
  if (req && req.headers && typeof req.headers.origin === 'string') {
    const value = req.headers.origin.trim();
    if (value) {
      return value;
    }
  }
  return '*';
}

function resolveRequestedHeaders(req) {
  if (!req || !req.headers) {
    return DEFAULT_ALLOW_HEADERS;
  }

  const raw = req.headers['access-control-request-headers'];
  let headerList = '';

  if (Array.isArray(raw)) {
    headerList = raw.join(',');
  } else if (typeof raw === 'string') {
    headerList = raw;
  }

  if (!headerList) {
    return DEFAULT_ALLOW_HEADERS;
  }

  const names = headerList
    .split(',')
    .map((name) => name.split(':')[0].trim())
    .filter(Boolean);

  return names.length ? names.join(', ') : DEFAULT_ALLOW_HEADERS;
}

export function applyLenientCors(req, res) {
  const origin = resolveOrigin(req);
  const reqHeaders = resolveRequestedHeaders(req);
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.setHeader('Access-Control-Allow-Headers', reqHeaders);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  return origin;
}

export function sendCorsOptions(req, res) {
  applyLenientCors(req, res);
  if (typeof res.status === 'function') {
    res.status(200);
  } else {
    res.statusCode = 200;
  }
  res.end();
}

export function sendJsonWithCors(req, res, status, payload) {
  applyLenientCors(req, res);
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  const body = payload == null ? {} : payload;
  const json = JSON.stringify(body);
  if (typeof res.json === 'function' && res.json !== sendJsonWithCors) {
    res.json(body);
    return;
  }
  res.end(json);
}

export async function runWithLenientCors(req, res, handler) {
  const originalEnd = typeof res.end === 'function' ? res.end : null;

  if (originalEnd) {
    res.end = function patchedEnd(...args) {
      applyLenientCors(req, res);
      return originalEnd.apply(this, args);
    };
  }

  try {
    applyLenientCors(req, res);
    const result = await handler();
    return result;
  } finally {
    if (originalEnd) {
      res.end = originalEnd;
    }
  }
}
