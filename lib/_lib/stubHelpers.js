const DEFAULT_FRONT_ORIGIN = 'https://mgm-app.vercel.app';

export function isStubEnabled() {
  return (process.env.SHOPIFY_ENABLED || '').trim() !== '1';
}

export function resolveFrontOrigin() {
  const raw = typeof process.env.FRONT_ORIGIN === 'string' ? process.env.FRONT_ORIGIN.trim() : '';
  const origin = raw ? raw : DEFAULT_FRONT_ORIGIN;
  return origin.replace(/\/+$/, '');
}

export function buildStubRequestId() {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${timePart}${randomPart}`;
}

export function applyStubCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
}

export function handleStubOptions(req, res) {
  if (req.method === 'OPTIONS') {
    applyStubCors(res);
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}
