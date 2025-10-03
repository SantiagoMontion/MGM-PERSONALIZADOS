export const config = { memory: 256, maxDuration: 10 };

function applyLenientCors(req: any, res: any) {
  const origin = req?.headers?.origin;
  const allowOrigin = typeof origin === 'string' && origin.length > 0 ? origin : '*';

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Debug-Fast');
  res.setHeader('Content-Type', 'application/json');
}

function extractBody(req: any) {
  const rawBody = req?.body;
  if (rawBody == null) return null;
  if (typeof rawBody === 'object') return rawBody;
  if (typeof rawBody === 'string') {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (error) {
      return null;
    }
  }
  return null;
}

export default async function handler(req: any, res: any) {
  applyLenientCors(req, res);

  const method = (req?.method || '').toUpperCase();

  if (method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return;
  }

  const body = extractBody(req);
  const hasUrl = body != null && Object.prototype.hasOwnProperty.call(body, 'url');

  if (!hasUrl) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: 'No url provided' }));
    return;
  }

  const rawUrl = body?.url;
  const publicUrl = typeof rawUrl === 'string' ? rawUrl : null;

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, mode: 'passthrough', publicUrl }));
}
