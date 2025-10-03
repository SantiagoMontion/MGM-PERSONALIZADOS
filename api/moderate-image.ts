// api/moderate-image.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// --- Config de serverless: más memoria/tiempo ---
export const config = { memory: 1024, maxDuration: 60 };

const ALLOWED = new Set([
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

  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // Fast mode manual para pruebas
    if (req.query?.debug === '1' || req.headers['x-debug-fast'] === '1') {
      return res.status(200).json({ ok: true, fast: true, rid });
    }

    // Desbloqueo inmediato: desactivar OCR por default con env OCR_ENABLED!=1
    if (process.env.OCR_ENABLED !== '1') {
      return res.status(200).json({ ok: true, ocr: 'disabled', rid });
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
      return res.status(400).json({ ok: false, reason: 'invalid_body', rid });
    }

    const image = body?.image;
    if (!image) {
      return res.status(400).json({ ok: false, reason: 'missing_image', rid });
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

    return res.status(200).json({ ok: true, rid /*, text: data.text */ });
    // ===========================================================
  } catch (err: any) {
    try {
      setCors(req, res);
    } catch {}
    console.error('moderate-image error', { rid, err: err?.message });
    return res.status(500).json({ error: err?.message || 'Internal error', rid });
  }
}
