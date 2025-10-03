export const config = { memory: 256, maxDuration: 10 };

const PASSTHROUGH_PLACEHOLDER_URL = 'https://picsum.photos/seed/mgm/800/600';

function applyLenientCors(req: any, res: any) {
  const origin = req?.headers?.origin;
  const allowOrigin = typeof origin === 'string' && origin.length > 0 ? origin : '*';

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Debug-Fast');
  res.setHeader('Content-Type', 'application/json');
}

function isPlainObject(value: any) {
  if (value == null) return false;
  if (Array.isArray(value)) return false;
  if (typeof value !== 'object') return false;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return false;
  return true;
}

async function readBodyAsString(req: any) {
  const rawBody = req?.body;
  if (typeof rawBody === 'string') {
    return rawBody;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawBody)) {
    return rawBody.toString('utf8');
  }
  if (rawBody == null && req && typeof req.on === 'function') {
    return new Promise<string | null>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: any) => {
        if (typeof chunk === 'string') {
          data += chunk;
          return;
        }
        if (chunk && typeof chunk.toString === 'function') {
          data += chunk.toString('utf8');
        }
      });
      req.on('end', () => resolve(data.length ? data : null));
      req.on('error', (err: Error) => reject(err));
    });
  }
  return null;
}

async function tryReadJsonBody(req: any) {
  const rawBody = req?.body;
  if (isPlainObject(rawBody)) {
    return rawBody;
  }

  try {
    const text = await readBodyAsString(req);
    if (typeof text === 'string' && text.trim().length) {
      return JSON.parse(text);
    }
  } catch (error) {
    return null;
  }

  return null;
}

function sendJson(res: any, statusCode: number, payload: Record<string, any>) {
  res.statusCode = statusCode;
  try {
    if (!res.headersSent) {
      res.setHeader?.('Content-Type', 'application/json');
    }
  } catch {}
  res.end(JSON.stringify(payload));
}

function enhanceResponse(res: any) {
  const originalStatus = typeof res.status === 'function' ? res.status.bind(res) : null;
  if (!originalStatus) {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
  }

  const originalJson = typeof res.json === 'function' ? res.json.bind(res) : null;
  res.json = (body: any) => {
    let payload = body;
    if (payload && typeof payload === 'object' && payload.ok === true) {
      const derivedPublicUrl =
        payload.publicUrl ?? payload.public_url ?? payload.file_original_url ?? null;
      if (payload.publicUrl !== derivedPublicUrl) {
        payload = { ...payload, publicUrl: derivedPublicUrl };
      }
    }

    if (originalJson) {
      return originalJson(payload);
    }

    try {
      res.setHeader?.('Content-Type', 'application/json');
    } catch {}
    res.end(JSON.stringify(payload));
    return res;
  };
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
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  if (process?.env?.UPLOAD_ENABLED === '1') {
    try {
      const module = await import('../lib/handlers/uploadOriginal.js');
      const realHandler = module?.default;
      if (typeof realHandler !== 'function') {
        throw new Error('upload_handler_unavailable');
      }

      enhanceResponse(res);
      await realHandler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: 'upload_unavailable' });
      }
    }
    return;
  }

  let publicUrl = PASSTHROUGH_PLACEHOLDER_URL;
  const contentType = String(req?.headers?.['content-type'] || req?.headers?.['Content-Type'] || '')
    .toLowerCase()
    .trim();

  const shouldAttemptJson = contentType.includes('application/json') || isPlainObject(req?.body);

  if (shouldAttemptJson) {
    const parsed = await tryReadJsonBody(req);
    const candidateUrl = parsed && typeof parsed.url === 'string' ? parsed.url.trim() : '';
    if (candidateUrl) {
      publicUrl = candidateUrl;
    }
  }

  sendJson(res, 200, { ok: true, mode: 'passthrough', publicUrl });
}
