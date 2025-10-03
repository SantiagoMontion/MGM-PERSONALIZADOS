// api/moderate-image.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { evaluateImage } from '../lib/handlers/moderateImage.js';

const ALLOWED = new Set<string>([
  'https://tu-mousepad-personalizado.mgmgamers.store',
  'http://localhost:5173',
]);

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.has(origin) ? origin : '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

function toBufferFromDataUrl(dataUrl: unknown) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  try {
    return Buffer.from(m[2], 'base64');
  } catch {
    return null;
  }
}

async function readBody(req: VercelRequest) {
  return new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  const rid = Date.now().toString(36);
  console.log('[moderate-image] start', { rid, method: req.method });

  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // Fast path de diagnóstico
    const fast = req.query?.debug === '1' || req.headers['x-debug-fast'] === '1';
    if (fast) {
      console.log('[moderate-image] FAST OK', { rid });
      return res.status(200).json({ ok: true, fast: true, rid });
    }

    // Si req.body puede venir string, intenta parsearlo a JSON
    let body: any = (req as any).body;
    if (Buffer.isBuffer(body)) {
      body = body.toString('utf8');
    }
    if (typeof body === 'string') {
      try {
        body = body ? JSON.parse(body) : null;
      } catch (err) {
        console.warn('[moderate-image] invalid JSON body (buffer)', { rid });
        body = null;
      }
    }

    if (!body || typeof body !== 'object') {
      const raw = await readBody(req);
      if (!raw) {
        console.warn('[moderate-image] empty body', { rid });
        return res.status(400).json({ ok: false, reason: 'invalid_body', rid });
      }
      try {
        body = JSON.parse(raw);
      } catch (err) {
        console.warn('[moderate-image] invalid JSON body', { rid });
        return res.status(400).json({ ok: false, reason: 'invalid_body', rid });
      }
    }

    // ===================== LÓGICA REAL EXISTENTE =====================
    const filename = typeof body?.filename === 'string' ? body.filename : '';
    const designName = typeof body?.designName === 'string' ? body.designName : '';

    let buffer: Buffer | null = null;
    if (body?.dataUrl) buffer = toBufferFromDataUrl(body.dataUrl);
    if (!buffer && typeof body?.imageBase64 === 'string') {
      try {
        buffer = Buffer.from(body.imageBase64, 'base64');
      } catch {
        buffer = null;
      }
    }
    if (!buffer) {
      console.warn('[moderate-image] missing buffer', { rid });
      return res.status(400).json({ ok: false, reason: 'invalid_body', rid });
    }

    const result = await evaluateImage(buffer, filename, designName);
    if (result?.label === 'BLOCK') {
      const reason = result.reasons?.[0] || 'blocked';
      return res.status(400).json({ ok: false, reason, rid, ...result });
    }

    return res.status(200).json({ ok: true, rid, ...(result || {}) });
    // ================================================================

  } catch (err: any) {
    // Asegurar CORS también en errores
    try { setCors(req, res); } catch {}
    console.error('[moderate-image] error', { rid, err: err?.message, stack: err?.stack });
    return res.status(500).json({ error: err?.message || 'Internal error', rid });
  } finally {
    console.log('[moderate-image] end', { rid });
  }
}
