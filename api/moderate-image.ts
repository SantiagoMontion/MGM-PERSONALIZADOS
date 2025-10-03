// api/moderate-image.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { applyCors, ensureJsonContentType } from './_lib/cors';

// --- Config de serverless: más memoria/tiempo ---
export const config = { memory: 1024, maxDuration: 60 };

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

function sendJson(res: VercelResponse, status: number, body: any) {
  ensureJsonContentType(res);
  res.status(status).send(JSON.stringify(body));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, 'POST, OPTIONS');
  const rid = Date.now().toString(36);

  try {
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    // Fast mode manual para pruebas
    if (req.query?.debug === '1' || req.headers['x-debug-fast'] === '1') {
      return sendJson(res, 200, { ok: true, fast: true, rid });
    }

    // Desbloqueo inmediato: desactivar OCR por default con env OCR_ENABLED!=1
    if (process.env.OCR_ENABLED !== '1') {
      return sendJson(res, 200, { ok: true, ocr: 'disabled' });
    }

    // Obtener body asegurando JSON válido
    let body: any = (req as any).body;
    if (Buffer.isBuffer(body)) {
      body = body.toString('utf8');
    }
    if (typeof body === 'string') {
      try {
        body = body ? JSON.parse(body) : null;
      } catch {
        body = null;
      }
    }
    if (!body || typeof body !== 'object') {
      const raw = await readBody(req);
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = null;
        }
      }
    }

    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { ok: false, error: 'invalid_body' });
    }

    const image = body?.image;
    if (!image) {
      return sendJson(res, 400, { ok: false, error: 'missing_image' });
    }

    // ========= OPCIÓN B: OCR con Tesseract usando CDN =========
    // Evita error ENOENT del .wasm (no lo busques en node_modules).
    // Ajusta versiones si hace falta.
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker({
      // worker / core / lang desde CDN (sin empaquetar archivos)
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.4/tesseract-core-simd.wasm.js',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0', // datos de idioma
      logger: () => {}, // opcional
    });

    try {
      await worker.loadLanguage('eng');
      await worker.initialize('eng');

      // Obtén el input
      // TODO: tu lógica real de OCR/moderación
      // const { data } = await worker.recognize(image);
    } finally {
      await worker.terminate();
    }

    return sendJson(res, 200, { ok: true, rid /*, text: data.text */ });
    // ===========================================================
  } catch (err: any) {
    applyCors(req, res, 'POST, OPTIONS');
    const diagId = `mid-${rid}`;
    console.error('moderate-image error', { rid, err: err?.message });
    return sendJson(res, 500, {
      ok: false,
      error: err?.message || 'internal_error',
      diagId,
    });
  }
}
