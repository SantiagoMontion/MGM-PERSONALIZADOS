const ALLOW_METHODS = 'POST, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization, Content-Type: application/json';

function resolveOrigin(req) {
  if (req && req.headers && typeof req.headers.origin === 'string') {
    const value = req.headers.origin.trim();
    if (value) {
      return value;
    }
  }
  return '*';
}

export function applyLenientCors(req, res) {
  const origin = resolveOrigin(req);
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
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
  res.end('');
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
