
import { supa } from '../lib/supa.js';
import { cors } from '../lib/cors.js';

// /api/upload-url.js
// Requiere: "type": "module" en package.json
import { z } from 'zod';

import { customAlphabet } from 'nanoid';

const nano = customAlphabet('abcdef0123456789', 8);

const BodySchema = z.object({
  ext: z.enum(['jpg','jpeg','png','webp']),
  mime: z.enum(['image/jpeg','image/png','image/webp']),
  size_bytes: z.number().int().positive(),
  material: z.enum(['Classic','PRO']),
  w_cm: z.number().positive(),
  h_cm: z.number().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 40);
const LIMITS = { Classic: { maxW: 140, maxH: 100 }, PRO: { maxW: 120, maxH: 60 } };

export default async function handler(req, res) {
  try {
    // Permitir ver por GET mientras diagnosticamos
    const info = {
      method: req.method,
      hasEnv: {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE
      },
      contentType: req.headers['content-type'] || null,
      bodyType: typeof req.body
    };

    if (req.method === 'GET') return res.status(200).json({ diag: info });
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed', diag: info });
    if (!info.hasEnv.SUPABASE_URL || !info.hasEnv.SUPABASE_SERVICE_ROLE) {
      return res.status(500).json({ error: 'missing_env', diag: info });
    }

    // Ping simple a Supabase para ver si crashea antes del parse
    const { data, error } = await supa.storage.listBuckets();
    if (error) return res.status(500).json({ step: 'listBuckets', message: String(error.message || error), diag: info });

    // Intenta parsear el body básico para detectar JSON mal
    let body;
    try { body = JSON.parse(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})); }
    catch (e) { return res.status(400).json({ error: 'invalid_json', message: String(e?.message||e), diag: info }); }

    return res.status(200).json({ ok: true, buckets: (data||[]).map(b=>b.name), diag: info });
  } catch (e) {
    return res.status(500).json({ step: 'catch', message: String(e?.message || e) });
  }
}
