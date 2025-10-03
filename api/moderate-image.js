import moderateImageHandler from '../api-routes/moderate-image.js';

const ALLOWED_ORIGINS = new Set([
  'https://tu-mousepad-personalizado.mgmgamers.store',
  'http://localhost:5173',
]);

function setCors(req, res) {
  const origin = req.headers?.origin || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  try {
    setCors(req, res);

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    return await moderateImageHandler(req, res);
  } catch (err) {
    try {
      setCors(req, res);
    } catch {}
    console.error('moderate-image error:', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}

