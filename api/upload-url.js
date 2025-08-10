
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
    // Permitir ver por GET mientras debug
    const info = {
      method: req.method,
      hasEnv: {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE
      }
    };
    if (req.method === 'GET') return res.status(200).json({ diag: info });
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed', diag: info });
    if (!info.hasEnv.SUPABASE_URL || !info.hasEnv.SUPABASE_SERVICE_ROLE) {
      return res.status(500).json({ step: 'env', message: 'missing_env', diag: info });
    }

    // 1) Ping: listar buckets
    const lb = await supa.storage.listBuckets();
    if (lb.error) {
      return res.status(500).json({ step: 'listBuckets', message: lb.error.message || String(lb.error) });
    }

    // 2) Firmar subida en bucket 'uploads' con una key simple de prueba
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
    const objectKey = `original/${y}/${m}/diag/test.jpg`; // ojo: sin "/" al inicio

    const signed = await supa.storage.from('uploads').createSignedUploadUrl(objectKey, 60);
    if (signed.error) {
      return res.status(500).json({
        step: 'createSignedUploadUrl',
        message: signed.error.message || String(signed.error),
        bucketTried: 'uploads',
        objectKey
      });
    }

    return res.status(200).json({
      ok: true,
      buckets: (lb.data || []).map(b => b.name),
      signed_ok: !!signed.data?.signedUrl,
      objectKey
    });
  } catch (e) {
    return res.status(500).json({ step: 'catch', message: e?.message || String(e) });
  }
}

