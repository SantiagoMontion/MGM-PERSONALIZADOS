const ALLOWED = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://mgm-api.vercel.app',
  'https://www.mgmgamers.store'
]);

function pickOrigin(req) {
  const o = req.headers.origin || '';
  return ALLOWED.has(o) ? o : 'http://localhost:5173';
}

function applyCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Si usamos cookies/credenciales, descomentar y NO usar '*':
  // res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function withCors(handler) {
  return async (req, res) => {
    const origin = pickOrigin(req);
    if (req.method === 'OPTIONS') {
      applyCors(res, origin);
      res.statusCode = 204;
      return res.end();
    }
    applyCors(res, origin);
    return handler(req, res);
  };
}

module.exports = { withCors };
